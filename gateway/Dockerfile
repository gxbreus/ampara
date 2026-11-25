FROM kong:3.8

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends gettext-base \
  && rm -rf /var/lib/apt/lists/*

COPY kong.template.yml /kong/kong.template.yml
COPY render-and-start.sh /render-and-start.sh
RUN chmod 0555 /render-and-start.sh && chown -R kong:kong /kong

USER kong
# KONG_NGINX_WORKER_PROCESSES: o padrão é um worker por núcleo. Numa máquina de 16 núcleos
# isso passa do limite de 256 MB do compose, e o kernel mata os workers em loop (signal 9).
ENV KONG_NGINX_WORKER_PROCESSES=2 \
    KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/kong/kong.yml \
    KONG_PROXY_LISTEN=0.0.0.0:8000 \
    KONG_ADMIN_LISTEN=127.0.0.1:8001

ENTRYPOINT ["/render-and-start.sh"]
