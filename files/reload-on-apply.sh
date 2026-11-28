#!/bin/sh
set -eu

[ "$(uci -q get nikkic.config.enabled || :)" = 1 ] || exit 0

# A registered instance already receives config.change through its own trigger.
service=$(ubus -t 3 call service list '{"name":"nikkic","verbose":true}')
trigger=$(printf '%s' "$service" | jsonfilter -e '@.nikkic.triggers[0][0]' || :)
[ "$trigger" != config.change ] || exit 0

exec /etc/init.d/nikkic reload
