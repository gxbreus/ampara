FROM mongo:7

COPY entrypoint.sh /usr/local/bin/ampara-entrypoint.sh
RUN chmod +x /usr/local/bin/ampara-entrypoint.sh

ENTRYPOINT ["ampara-entrypoint.sh"]
CMD ["mongod", "--replSet", "rs0", "--keyFile", "/data/db/keyfile", "--bind_ip_all", "--wiredTigerCacheSizeGB", "0.25"]
