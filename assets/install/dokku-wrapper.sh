#!/bin/sh
set -eu

app_pattern='^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'

is_app() {
  printf '%s\n' "$1" | grep -Eq "$app_pattern"
}

is_limit() {
  case "$1" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 500 ]
}

allowed=0
case "$#" in
  1)
    if [ "$1" = "version" ] || [ "$1" = "events" ]; then
      allowed=1
    fi
    ;;
  2)
    if [ "$1" = "--quiet" ] && [ "$2" = "apps:list" ]; then
      allowed=1
    elif [ "$1" = "urls" ] && is_app "$2"; then
      allowed=1
    elif [ "$1" = "letsencrypt:active" ] && is_app "$2"; then
      allowed=1
    elif { [ "$1" = "ps:restart" ] || [ "$1" = "ps:rebuild" ]; } && is_app "$2"; then
      allowed=1
    fi
    ;;
  3)
    if [ "$1" = "ps:report" ] && is_app "$2" && { [ "$3" = "--running" ] || [ "$3" = "--deployed" ] || [ "$3" = "--status" ]; }; then
      allowed=1
    elif [ "$1" = "ports:report" ] && is_app "$2" && [ "$3" = "--ports-map" ]; then
      allowed=1
    elif [ "$1" = "domains:report" ] && is_app "$2" && [ "$3" = "--domains-app-vhosts" ]; then
      allowed=1
    fi
    ;;
  4)
    if [ "$1" = "logs" ] && is_app "$2" && [ "$3" = "--num" ] && is_limit "$4"; then
      allowed=1
    fi
    ;;
esac

if [ "$allowed" -ne 1 ]; then
  echo "nemo-agent: Dokku command is not allowlisted" >&2
  exit 64
fi

if command -v dokku >/dev/null 2>&1; then
  exec dokku "$@"
fi

if [ -x /usr/bin/dokku ]; then
  exec /usr/bin/dokku "$@"
fi

if [ -x /usr/local/bin/dokku ]; then
  exec /usr/local/bin/dokku "$@"
fi

echo "nemo-agent: dokku binary not found" >&2
exit 127
