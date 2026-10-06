# Tally Bridge Daemon (`tally-bridge.exe`)

Runs on the jeweller's Windows PC next to Tally. It makes **outbound-only** HTTPS calls to your cloud relay
(Cloudflare Worker + D1), picks up XML jobs queued by the web app (from a PC **or a phone**), runs them in Tally on
`127.0.0.1:9000`, and reports Tally's real result back.

```
Browser (PC / phone) → your domain → Cloud relay ← polls (outbound) ← tally-bridge.exe → Tally :9000
```

No port forwarding or static IP is needed at the shop. The shop PC must be on, with the bridge running and the company open in Tally.

## Build

The Worker URL is baked in at build time (nothing personal is hardcoded in the source):

```bash
# Windows
go build -ldflags "-s -w -X main.DefaultCloudWorkerURL=https://atits-auth.abhishek791996.workers.dev" -o tally-bridge.exe main.go

# Cross-compile from Mac / Linux
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -X main.DefaultCloudWorkerURL=https://YOUR-WORKER.workers.dev" -o tally-bridge.exe main.go
```

## Client setup
1. Run `tally-bridge.exe`, enter the license key (`JWEL-XXXX-XXXX-XXXX`) once. It registers auto-start and runs hidden.
2. In Tally: F1 → Settings → Connectivity → enable the server on port 9000. Open the company.
3. In the web app: Company Settings → enter the same license key and the exact Tally company name.

## Flags
| Flag | Purpose |
|---|---|
| `--silent` | no console (used by auto-start) |
| `--reset-key` | remove stored license and auto-start |
| `--local-api` | also expose `127.0.0.1:8080` (testing only; **off by default**) |
| `--allow-origin URL` | extra browser origin allowed to call the local API |

## Result statuses sent to the relay
`success`, `tally_rejected` (Tally replied but with errors — full `LINEERROR` text included), `tally_offline` (port 9000 unreachable).

## Tally Educational mode
Only vouchers dated the 1st, 2nd or last day of a month are accepted. Turn on **Educational mode** in the web app's Company Settings while testing. Turn it **off** for licensed Tally.

## Local test (needs `--local-api`)
```powershell
Invoke-WebRequest -Uri "http://localhost:8080/ping" -UseBasicParsing
```
