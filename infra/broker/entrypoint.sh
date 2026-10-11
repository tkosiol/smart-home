#!/bin/sh
# Builds the password file from env vars on every start, so no hash is committed.
set -eu
: "${MQTT_USER:?MQTT_USER is required}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required}"

PASSWD=/mosquitto/data/passwd
rm -f "$PASSWD"
mosquitto_passwd -c -b "$PASSWD" "$MQTT_USER" "$MQTT_PASSWORD"
chown mosquitto:mosquitto "$PASSWD"
chmod 0700 "$PASSWD"

exec mosquitto -c /mosquitto/config/mosquitto.conf
