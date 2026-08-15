#!/usr/bin/env bash
# Restart the dsh web GUI so the freshly built/installed dsh-news plugin
# bundle takes effect (new client bundle + boot graph). Run from any shell:
#   bash scripts/restart-web.sh
set -u
OLD_PID=$(pgrep -f "dsh web" | head -1 || true)
if [ -n "${OLD_PID:-}" ]; then
  echo "stopping dsh web (pid ${OLD_PID})…"
  kill "${OLD_PID}" 2>/dev/null || true
  sleep 2
fi
cd "${HOME}" || exit 1
nohup node "${HOME}/.npm-global/bin/dsh" web > "${HOME}/.dsh/dsh-web.log" 2>&1 &
echo "dsh web restarted (pid $!), log: ${HOME}/.dsh/dsh-web.log"
sleep 3
curl -s -o /dev/null -w "GUI reachable: http://127.0.0.1:3080 → HTTP %{http_code}\n" http://127.0.0.1:3080 || echo "GUI not reachable yet — check the log"
