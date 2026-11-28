#!/bin/sh
set -eu
umask 077
profile=${NIKKIC_HOME:-/etc/nikkic}/run/controller.json
value() { jsonfilter -i "$profile" -e "@.$1"; }
secret=$(value Secret)
address=$(value Listen)
protocol=http
if [ -z "$address" ]; then
    address=$(value TLSListen)
    protocol=https
fi
case "$address" in
    [Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt]:*|0.0.0.0:*|:*) address=127.0.0.1:${address##*:} ;;
    '[::]:'*) address="[::1]:${address##*:}" ;;
esac
port=${address##*:}
case "$port" in ''|*[!0-9]*) exit 2 ;; esac
set -- --max-time 42 --request POST --url "$protocol://$address/upgrade/ui"
if [ -n "$secret" ]; then
    set -- "$@" --oauth2-bearer "$secret"
fi
curl --noproxy '*' --silent --show-error --insecure "$@"
