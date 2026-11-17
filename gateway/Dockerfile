FROM kong:3.8

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends gettext-base \
  && rm -rf /var/lib/apt/lists/*

COPY kong.template.yml /kong/kong.template.yml
COPY render-and-start.sh /render-and-start.sh
RUN chmod 0555 /render-and-start.sh && chown -R kong:kong /kong

USER kong
ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/kong/kong.yml \
    KONG_PROXY_LISTEN=0.0.0.0:8000 \
    KONG_ADMIN_LISTEN=127.0.0.1:8001

ENTRYPOINT ["/render-and-start.sh"]
