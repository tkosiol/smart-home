FROM eclipse-mosquitto:2.1.2-alpine
COPY mosquitto.conf tls.conf acl /mosquitto/config/
COPY entrypoint.sh /smart/entrypoint.sh
ENTRYPOINT ["/bin/sh", "/smart/entrypoint.sh"]
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD mosquitto_sub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t '$SYS/broker/uptime' -C 1 -W 3 > /dev/null || exit 1
