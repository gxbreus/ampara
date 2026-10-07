FROM rabbitmq:3.13-management-alpine

COPY rabbitmq.conf definitions.json /etc/rabbitmq/
COPY entrypoint.sh /usr/local/bin/ampara-entrypoint.sh
RUN chmod +x /usr/local/bin/ampara-entrypoint.sh

ENTRYPOINT ["ampara-entrypoint.sh"]
