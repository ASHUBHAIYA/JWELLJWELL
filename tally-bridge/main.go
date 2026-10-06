package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

// =========================================================================
// Configuration
// =========================================================================
const (
	LocalBridgePort          = ":8080"
	TallyPrimeEndpoint       = "http://127.0.0.1:9000"
	EncryptedLicenseFileName = ".tally_license.dat"
	LogFileName              = "tally-bridge.log"
	MaxPayloadBytes          = 20 << 20 // 20 MB
)

// Injected at build time:
//
//	go build -ldflags "-s -w -X main.DefaultCloudWorkerURL=https://your-worker.example.workers.dev" -o tally-bridge.exe main.go
//
// Can also be provided at runtime via the TALLY_BRIDGE_WORKER_URL environment variable.
var DefaultCloudWorkerURL = ""

// Origins allowed to call the optional local API (--local-api). Add your production domain with --allow-origin.
var allowedOrigins = []string{"http://localhost:3000", "http://localhost:5173"}

// Windows Console API integration
var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	user32          = syscall.NewLazyDLL("user32.dll")
	procGetConsole  = kernel32.NewProc("GetConsoleWindow")
	procShowWindow  = user32.NewProc("ShowWindow")
	procFreeConsole = kernel32.NewProc("FreeConsole")
)

const SW_HIDE = 0

func hideConsoleWindow() {
	if runtime.GOOS == "windows" {
		hwnd, _, _ := procGetConsole.Call()
		if hwnd != 0 {
			procShowWindow.Call(hwnd, uintptr(SW_HIDE))
		}
	}
}

func detachConsole() {
	if runtime.GOOS == "windows" {
		procFreeConsole.Call()
	}
}

// License Verification Request / Response
type LicenseVerifyReq struct {
	LicenseKey string `json:"licenseKey"`
	MachineID  string `json:"machineId"`
}

type LicenseVerifyResp struct {
	Success   bool   `json:"success"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expires_at"`
	StoreName string `json:"storeName"`
	MachineID string `json:"machineId"`
	Error     string `json:"error"`
}

type BridgeLogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
}

var (
	activeLicenseKey string
	activeStoreName  string
	activeMachineID  string
	activeExpiresAt  string

	logMutex   sync.Mutex
	recentLogs []BridgeLogEntry
	logFile    *os.File
	isSilent   bool
)

func main() {
	silentFlag := flag.Bool("silent", false, "Run silently in background without console window")
	autostartFlag := flag.Bool("autostart", false, "Install tally-bridge to run automatically on Windows startup")
	removeAutostartFlag := flag.Bool("remove-autostart", false, "Remove tally-bridge from Windows startup")
	resetKeyFlag := flag.Bool("reset-key", false, "Clear registered license key on this PC")
	localAPIFlag := flag.Bool("local-api", false, "Also expose the local HTTP API on 127.0.0.1:8080 (for testing only; the cloud relay is the normal path)")
	allowOriginFlag := flag.String("allow-origin", "", "Extra browser origin allowed to call the local API, e.g. https://app.yourdomain.com")
	flag.Parse()

	if *allowOriginFlag != "" {
		allowedOrigins = append(allowedOrigins, strings.TrimRight(*allowOriginFlag, "/"))
	}
	if envURL := strings.TrimSpace(os.Getenv("TALLY_BRIDGE_WORKER_URL")); envURL != "" {
		DefaultCloudWorkerURL = strings.TrimRight(envURL, "/")
	}
	DefaultCloudWorkerURL = strings.TrimRight(DefaultCloudWorkerURL, "/")

	isSilent = *silentFlag

	// If invoked on startup, hide the window immediately
	if isSilent {
		hideConsoleWindow()
		detachConsole()
	}

	initLogger()
	defer closeLogger()

	if *resetKeyFlag {
		removeStoredLicense()
		setupWindowsStartup(false)
		if !isSilent {
			fmt.Println("[✓] License key and startup registration removed from local PC.")
		}
		return
	}

	if *autostartFlag {
		setupWindowsStartup(true)
		return
	}

	if *removeAutostartFlag {
		setupWindowsStartup(false)
		return
	}

	if !isSilent {
		printBanner()
	}
	logMessage("SYSTEM", "INFO", "Starting ATITS Tally Bridge Daemon...")

	// 1. Hardware ID check
	machineID := getHardwareMachineID()
	activeMachineID = machineID
	logMessage("HARDWARE", "INFO", fmt.Sprintf("Hardware Machine ID: %s", machineID))

	// 2. Load cached license or ask user interactively
	licenseKey, isFirstTime := loadOrPromptLicense(machineID)
	activeLicenseKey = licenseKey

	// 3. Verify License (retry on network errors; only an explicit rejection clears the stored key)
	if DefaultCloudWorkerURL == "" {
		logMessage("AUTH", "FATAL", "Cloud Worker URL not configured. Rebuild with -X main.DefaultCloudWorkerURL=... or set TALLY_BRIDGE_WORKER_URL.")
		if !isSilent {
			fmt.Println("[!] Cloud Worker URL is not configured in this build. Contact support.")
			fmt.Println("\nPress Enter to exit...")
			fmt.Scanln()
		}
		os.Exit(1)
	}

	logMessage("AUTH", "INFO", "Authenticating license with central cloud database...")
	var verified *LicenseVerifyResp
	for attempt := 1; ; attempt++ {
		var netErr bool
		verified, netErr = verifyLicenseKey(licenseKey, machineID)
		if !netErr {
			break
		}
		logMessage("AUTH", "WARN", fmt.Sprintf("License server unreachable (attempt %d). Retrying...", attempt))
		if !isSilent && attempt >= 3 {
			fmt.Println("\n[!] Cannot reach the license server. Check the internet connection and run again.")
			fmt.Println("\nPress Enter to exit...")
			fmt.Scanln()
			os.Exit(1)
		}
		// Silent (startup) mode: internet may not be up yet right after boot, keep trying.
		time.Sleep(15 * time.Second)
	}

	if verified != nil && verified.Success {
		activeStoreName = verified.StoreName
		activeExpiresAt = verified.ExpiresAt
		logMessage("AUTH", "SUCCESS", fmt.Sprintf("License validated for '%s' (Expires: %s)", verified.StoreName, verified.ExpiresAt))

		// Automatically configure Windows Startup with --silent flag
		setupWindowsStartup(true)

		if !isSilent {
			fmt.Println("\n====================================================")
			fmt.Printf("  Store Registered : %s\n", verified.StoreName)
			fmt.Printf("  Valid Until      : %s\n", verified.ExpiresAt)
			fmt.Printf("  Hardware Lock    : ACTIVE (Single-PC Protected)\n")
			fmt.Printf("  Relay            : %s\n", DefaultCloudWorkerURL)
			fmt.Printf("  Tally Endpoint   : %s\n", TallyPrimeEndpoint)
			fmt.Printf("  Log File Path    : %s\n", getLogFilePath())
			fmt.Println("====================================================")
		}
	} else {
		errorMsg := "Invalid license key."
		if verified != nil && verified.Error != "" {
			errorMsg = verified.Error
		}
		logMessage("AUTH", "ERROR", fmt.Sprintf("License check failed: %s", errorMsg))
		removeStoredLicense() // explicit rejection from server only
		if !isSilent {
			fmt.Printf("\n[!] Activation Error: %s\n", errorMsg)
			fmt.Println("[!] Please contact tech support to issue a valid license.")
			fmt.Println("\nPress Enter to exit...")
			fmt.Scanln()
		}
		os.Exit(1)
	}

	// 4. Optional local HTTP API (off by default: it is a local attack surface and the relay covers PC + mobile)
	if *localAPIFlag {
		go startLocalHTTPBridge()
	}

	// 5. Start Background Cloud Relay Worker
	go startCloudRelayPoller(licenseKey)

	logMessage("SYSTEM", "READY", "Tally Bridge daemon active.")

	// If interactive setup (first-time key entry or manual launch without --silent),
	// countdown 7 seconds and close/detach the console window so it remains running silently.
	if !isSilent {
		if isFirstTime {
			fmt.Println("\n[✓] Connection test passed! Auto-start registered.")
			fmt.Println("[i] This window will close in 7 seconds and run in the background.")
			for i := 7; i > 0; i-- {
				fmt.Printf("\rClosing console in %d seconds... ", i)
				time.Sleep(1 * time.Second)
			}
			fmt.Printf("\rClosing console now. Running in background.       \n")
		} else {
			fmt.Println("[✓] Background daemon active. Closing console in 3 seconds...")
			time.Sleep(3 * time.Second)
		}

		hideConsoleWindow()
		detachConsole()
		isSilent = true
	}

	// Keep daemon running indefinitely
	select {}
}

// =========================================================================
// Logging Subsystem
// =========================================================================
func getLogFilePath() string {
	appData, err := os.UserConfigDir()
	if err != nil {
		appData = "."
	}
	dir := filepath.Join(appData, "ATITS_ERP")
	_ = os.MkdirAll(dir, 0700)
	return filepath.Join(dir, LogFileName)
}

func initLogger() {
	p := getLogFilePath()
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err == nil {
		logFile = f
	}
}

func closeLogger() {
	if logFile != nil {
		_ = logFile.Close()
	}
}

func logMessage(source, level, msg string) {
	entry := BridgeLogEntry{
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
		Level:     level,
		Source:    source,
		Message:   msg,
	}

	logMutex.Lock()
	recentLogs = append(recentLogs, entry)
	if len(recentLogs) > 200 {
		recentLogs = recentLogs[len(recentLogs)-200:]
	}
	logMutex.Unlock()

	formatted := fmt.Sprintf("[%s] [%s] [%s] %s\n", entry.Timestamp, entry.Source, entry.Level, entry.Message)

	if !isSilent {
		fmt.Print(formatted)
	}

	if logFile != nil {
		_, _ = logFile.WriteString(formatted)
	}
}

// =========================================================================
// Hardware Machine ID
// =========================================================================
func getHardwareMachineID() string {
	var rawID string

	if runtime.GOOS == "windows" {
		out, err := exec.Command("wmic", "csproduct", "get", "UUID").Output()
		if err == nil && len(out) > 0 {
			rawID = strings.TrimSpace(strings.ReplaceAll(string(out), "UUID", ""))
		}
		if rawID == "" {
			out2, _ := exec.Command("wmic", "bios", "get", "serialnumber").Output()
			rawID = strings.TrimSpace(strings.ReplaceAll(string(out2), "SerialNumber", ""))
		}
		if rawID == "" {
			// wmic is removed in recent Windows 11 builds
			out3, err3 := exec.Command("powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID").Output()
			if err3 == nil {
				rawID = strings.TrimSpace(string(out3))
			}
		}
	} else if runtime.GOOS == "darwin" {
		out, _ := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
		rawID = string(out)
	} else {
		data, _ := os.ReadFile("/etc/machine-id")
		rawID = string(data)
	}

	if strings.TrimSpace(rawID) == "" {
		h, _ := os.Hostname()
		rawID = h + "_fallback_node"
	}

	hash := sha256.Sum256([]byte("ATITS_SALT_" + rawID))
	return strings.ToUpper(hex.EncodeToString(hash[:]))[:16]
}

// =========================================================================
// Encrypted License Storage
// =========================================================================
func getLicenseFilePath() string {
	appData, err := os.UserConfigDir()
	if err != nil {
		appData = "."
	}
	dir := filepath.Join(appData, "ATITS_ERP")
	_ = os.MkdirAll(dir, 0700)
	return filepath.Join(dir, EncryptedLicenseFileName)
}

func loadOrPromptLicense(machineID string) (string, bool) {
	filePath := getLicenseFilePath()

	if data, err := os.ReadFile(filePath); err == nil && len(data) > 0 {
		decryptedKey := decryptString(data, machineID)
		if strings.HasPrefix(decryptedKey, "JWEL-") {
			return decryptedKey, false
		}
	}

	// If running under --silent flag and no key is saved, cannot prompt
	if isSilent {
		logMessage("AUTH", "FATAL", "No license found on system while running silently.")
		os.Exit(1)
	}

	fmt.Println("====================================================")
	fmt.Println("         FIRST-TIME SOFTWARE ACTIVATION             ")
	fmt.Println("====================================================")
	fmt.Println("Please enter your 1-Year Commercial License Key:")
	fmt.Println("Example: JWEL-XXXX-XXXX-XXXX")
	fmt.Print("\nLicense Key: ")

	var inputKey string
	fmt.Scanln(&inputKey)
	inputKey = strings.TrimSpace(inputKey)

	if inputKey == "" {
		fmt.Println("[!] License Key cannot be empty. Exiting.")
		os.Exit(1)
	}

	encryptedData := encryptString(inputKey, machineID)
	_ = os.WriteFile(filePath, encryptedData, 0600)
	fmt.Println("\n[✓] License key encrypted & registered to this PC.")

	return inputKey, true
}

func removeStoredLicense() {
	_ = os.Remove(getLicenseFilePath())
}

func getEncryptionKey(machineID string) []byte {
	k := sha256.Sum256([]byte("ATITS_SECRET_KEY_SEED_" + machineID))
	return k[:]
}

func encryptString(plainText, machineID string) []byte {
	key := getEncryptionKey(machineID)
	block, err := aes.NewCipher(key)
	if err != nil {
		return []byte(plainText)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return []byte(plainText)
	}
	nonce := make([]byte, gcm.NonceSize())
	_, _ = io.ReadFull(rand.Reader, nonce)
	return gcm.Seal(nonce, nonce, []byte(plainText), nil)
}

func decryptString(cipherText []byte, machineID string) string {
	key := getEncryptionKey(machineID)
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	nonceSize := gcm.NonceSize()
	if len(cipherText) < nonceSize {
		return ""
	}
	nonce, ct := cipherText[:nonceSize], cipherText[nonceSize:]
	plainText, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return ""
	}
	return string(plainText)
}

// =========================================================================
// Verify License against Cloud Database
// =========================================================================
func verifyLicenseKey(licenseKey, machineID string) (*LicenseVerifyResp, bool) {
	reqBody, _ := json.Marshal(LicenseVerifyReq{
		LicenseKey: licenseKey,
		MachineID:  machineID,
	})

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(DefaultCloudWorkerURL+"/verify-license", "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, true
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return nil, true
	}

	var result LicenseVerifyResp
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, false
}

// =========================================================================
// Local HTTP Server on Port 8080
// =========================================================================
func startLocalHTTPBridge() {
	mux := http.NewServeMux()

	mux.HandleFunc("/ping", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		tallyOnline := checkTallyPrimeAlive()
		company := getTallyActiveCompany()

		statusStr := "OFFLINE"
		if tallyOnline {
			statusStr = fmt.Sprintf("ONLINE (Company: '%s')", company)
		}
		logMessage("UI_PING", "INFO", fmt.Sprintf("Web UI Ping received. Tally Status: %s", statusStr))

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"online":      true,
			"tallyOnline": tallyOnline,
			"company":     company,
			"storeName":   activeStoreName,
			"expiresAt":   activeExpiresAt,
			"machineId":   activeMachineID,
			"version":     "1.1.0",
		})
	}))

	mux.HandleFunc("/tally/push", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, MaxPayloadBytes))
		if err != nil || len(bodyBytes) == 0 {
			logMessage("UI_PUSH", "ERROR", "Received empty payload from Web UI")
			http.Error(w, "Empty XML Payload", http.StatusBadRequest)
			return
		}

		xmlString := string(bodyBytes)
		if !looksLikeTallyEnvelope(xmlString) {
			logMessage("UI_PUSH", "ERROR", "Rejected payload that is not a Tally <ENVELOPE>")
			http.Error(w, "Payload must be a Tally XML <ENVELOPE>", http.StatusBadRequest)
			return
		}
		logMessage("UI_PUSH", "INFO", fmt.Sprintf("Push request received from Web UI (%d bytes). Forwarding to Tally Prime...", len(xmlString)))

		tallyResp, err := postXMLToTally(xmlString)
		if err != nil {
			logMessage("TALLY_API", "ERROR", fmt.Sprintf("Failed to communicate with Tally Prime on %s: %v", TallyPrimeEndpoint, err))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Failed to communicate with Tally Prime on %s: %v", TallyPrimeEndpoint, err),
			})
			return
		}

		status, summary := classifyTallyResponse(tallyResp)
		logMessage("TALLY_API", strings.ToUpper(status), summary)

		w.Header().Set("Content-Type", "application/xml")
		w.Write([]byte(tallyResp))
	}))

	mux.HandleFunc("/logs", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		logMutex.Lock()
		defer logMutex.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"storeName": activeStoreName,
			"expiresAt": activeExpiresAt,
			"logFile":   getLogFilePath(),
			"logs":      recentLogs,
		})
	}))

	server := &http.Server{
		Addr:    LocalBridgePort,
		Handler: mux,
	}
	_ = server.ListenAndServe()
}

// =========================================================================
// Push XML to Local Tally Prime
// =========================================================================
func postXMLToTally(xmlPayload string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("POST", TallyPrimeEndpoint, bytes.NewBufferString(xmlPayload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "text/xml;charset=utf-8")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(respBytes), nil
}

func checkTallyPrimeAlive() bool {
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get(TallyPrimeEndpoint)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func getTallyActiveCompany() string {
	xmlReq := `<?xml version="1.0" encoding="utf-8"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`
	resp, err := postXMLToTally(xmlReq)
	if err != nil {
		return ""
	}
	return extractTagValue(resp, "COMPANYNAME")
}

var (
	reLineError = regexp.MustCompile(`(?is)<LINEERROR[^>]*>(.*?)</LINEERROR>`)
	reNumTag    = func(tag string) *regexp.Regexp {
		return regexp.MustCompile(`(?is)<` + tag + `[^>]*>\s*(\d+)\s*</` + tag + `>`)
	}
	reCreated = reNumTag("CREATED")
	reAltered = reNumTag("ALTERED")
	reErrors  = reNumTag("ERRORS")
	reExcept  = reNumTag("EXCEPTIONS")
)

func looksLikeTallyEnvelope(x string) bool {
	return strings.Contains(strings.ToUpper(x), "<ENVELOPE")
}

func firstInt(re *regexp.Regexp, s string) int {
	m := re.FindStringSubmatch(s)
	if len(m) < 2 {
		return 0
	}
	n := 0
	fmt.Sscanf(m[1], "%d", &n)
	return n
}

// classifyTallyResponse reads Tally's real answer. Import requests that Tally rejected still come back HTTP 200,
// so "no transport error" must NOT be reported as success. Exports (no CREATED/ERRORS tags) are treated as success.
// Returns: "success" | "tally_rejected", and a human summary containing every LINEERROR.
func classifyTallyResponse(resp string) (string, string) {
	created := firstInt(reCreated, resp)
	altered := firstInt(reAltered, resp)
	errs := firstInt(reErrors, resp) + firstInt(reExcept, resp)

	var lineErrs []string
	for _, m := range reLineError.FindAllStringSubmatch(resp, -1) {
		lineErrs = append(lineErrs, strings.TrimSpace(m[1]))
	}
	lower := strings.ToLower(resp)
	isImportReply := strings.Contains(resp, "<CREATED>") || strings.Contains(resp, "<ERRORS>") || len(lineErrs) > 0

	if strings.Contains(lower, "could not set") && len(lineErrs) == 0 {
		lineErrs = append(lineErrs, "Tally could not open the company. Check the company name and that it is open.")
	}
	if strings.Contains(lower, "unknown request") {
		lineErrs = append(lineErrs, "Tally: Unknown request")
	}

	summary := fmt.Sprintf("Created: %d, Altered: %d, Errors: %d", created, altered, errs)
	if len(lineErrs) > 0 {
		summary += " | " + strings.Join(lineErrs, " | ")
	}

	if len(lineErrs) > 0 || errs > 0 || (isImportReply && created+altered == 0) {
		return "tally_rejected", summary
	}
	return "success", summary
}

func extractTagValue(xml, tagName string) string {
	openTag := "<" + tagName + ">"
	closeTag := "</" + tagName + ">"
	if strings.Contains(xml, openTag) && strings.Contains(xml, closeTag) {
		parts := strings.Split(xml, openTag)
		if len(parts) > 1 {
			return strings.Split(parts[1], closeTag)[0]
		}
	}
	return ""
}

// =========================================================================
// Cloud Long-Poller
// =========================================================================
func startCloudRelayPoller(licenseKey string) {
	client := &http.Client{Timeout: 40 * time.Second}
	backoff := 2 * time.Second

	for {
		time.Sleep(backoff)

		// License goes in a header (query strings end up in server logs); the query param is kept for older Workers.
		req, err := http.NewRequest("GET", fmt.Sprintf("%s/relay/poll?licenseKey=%s", DefaultCloudWorkerURL, url.QueryEscape(licenseKey)), nil)
		if err != nil {
			continue
		}
		req.Header.Set("X-License-Key", licenseKey)

		resp, err := client.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil {
				resp.Body.Close()
			}
			// Back off while offline / server erroring, then recover to a quick poll.
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = 2 * time.Second

		var pollResult struct {
			Pending bool   `json:"pending"`
			JobID   string `json:"jobId"`
			Data    struct {
				// The web app queues {licenseKey, xml, timestamp}. Older builds looked for "xmlPayload",
				// which never existed, so relay jobs were silently dropped. Accept both.
				XML        string `json:"xml"`
				XMLPayload string `json:"xmlPayload"`
			} `json:"data"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, MaxPayloadBytes)).Decode(&pollResult)
		resp.Body.Close()

		if !pollResult.Pending || pollResult.JobID == "" {
			continue
		}

		xmlPayload := pollResult.Data.XML
		if xmlPayload == "" {
			xmlPayload = pollResult.Data.XMLPayload
		}

		status := "success"
		errMsg := ""
		tallyResp := ""

		switch {
		case xmlPayload == "" || !looksLikeTallyEnvelope(xmlPayload):
			status = "tally_rejected"
			errMsg = "Job had no valid Tally XML payload."
			logMessage("CLOUD_RELAY", "ERROR", fmt.Sprintf("Job %s skipped: no valid XML payload.", pollResult.JobID))
		default:
			logMessage("CLOUD_RELAY", "INFO", fmt.Sprintf("Executing Cloud Job %s in Tally Prime (%d bytes)...", pollResult.JobID, len(xmlPayload)))
			resp2, err := postXMLToTally(xmlPayload)
			if err != nil {
				status = "tally_offline"
				errMsg = "Tally is not reachable on port 9000. Open Tally, load the company and enable the ODBC/HTTP server (F1 > Settings > Connectivity)."
				logMessage("CLOUD_RELAY", "ERROR", fmt.Sprintf("Job %s failed: %v", pollResult.JobID, err))
			} else {
				tallyResp = resp2
				st, summary := classifyTallyResponse(resp2)
				status = st
				if st != "success" {
					errMsg = summary
					logMessage("CLOUD_RELAY", "ERROR", fmt.Sprintf("Job %s rejected by Tally: %s", pollResult.JobID, summary))
				} else {
					logMessage("CLOUD_RELAY", "SUCCESS", fmt.Sprintf("Job %s completed. %s", pollResult.JobID, summary))
				}
			}
		}

		statusBody, _ := json.Marshal(map[string]interface{}{
			"jobId":         pollResult.JobID,
			"status":        status,
			"error":         errMsg,
			"tallyResponse": tallyResp,
		})

		// Never lose a result: if reporting fails the browser would wait forever and the user would re-push.
		for attempt := 1; attempt <= 4; attempt++ {
			rq, _ := http.NewRequest("POST", DefaultCloudWorkerURL+"/relay/status", bytes.NewBuffer(statusBody))
			rq.Header.Set("Content-Type", "application/json")
			rq.Header.Set("X-License-Key", licenseKey)
			r2, e2 := client.Do(rq)
			if e2 == nil {
				ok := r2.StatusCode < 300
				r2.Body.Close()
				if ok {
					break
				}
			}
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
	}
}

// =========================================================================
// Windows Auto-Start Registry Configuration
// =========================================================================
func setupWindowsStartup(enable bool) {
	if runtime.GOOS != "windows" {
		return
	}
	exePath, err := os.Executable()
	if err != nil {
		logMessage("STARTUP", "ERROR", fmt.Sprintf("Failed to get executable path: %v", err))
		return
	}

	// Register with the --silent argument so Windows launches it hidden
	startupCommand := fmt.Sprintf("\"%s\" --silent", exePath)

	if enable {
		cmd := exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "ATITSTallyBridge", "/t", "REG_SZ", "/d", startupCommand, "/f")
		err = cmd.Run()
		if err == nil {
			logMessage("STARTUP", "SUCCESS", "Registered in Windows Startup with --silent mode.")
		} else {
			logMessage("STARTUP", "ERROR", fmt.Sprintf("Registry setup failed: %v", err))
		}
	} else {
		cmd := exec.Command("reg", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "ATITSTallyBridge", "/f")
		_ = cmd.Run()
		logMessage("STARTUP", "INFO", "Removed from Windows Startup.")
	}
}

// =========================================================================
// CORS Middleware
// =========================================================================
func originAllowed(origin string) bool {
	for _, o := range allowedOrigins {
		if strings.EqualFold(o, origin) {
			return true
		}
	}
	return false
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Browsers always send Origin on cross-site calls. Any website the shopkeeper happens to open could
		// otherwise POST XML into their books, so unknown origins are refused. Non-browser tools (no Origin) still work.
		if origin != "" {
			if !originAllowed(origin) {
				http.Error(w, "Origin not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func printBanner() {
	fmt.Println("╔════════════════════════════════════════════════════════╗")
	fmt.Println("║          ATITS TALLY PRIME BRIDGE DAEMON               ║")
	fmt.Println("║     Gold/Silver Bill Splitter & Bank Statement Sync    ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝")
	fmt.Println()
}
