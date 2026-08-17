FROM python:3.11-slim

WORKDIR /app

# 默认走国内镜像:官方源在国内拉取极慢甚至连不上,而本项目用户绝大多数在国内,
# 默认值该照顾多数人。境外构建传空值即可回到官方源:
#   docker build --build-arg APT_MIRROR= --build-arg PIP_INDEX_URL= ...
ARG APT_MIRROR=mirrors.ustc.edu.cn
ARG PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple/

# sources.list 与 debian.sources 两种格式并存(基础镜像版本不同),各发行版只会命中一个
RUN set -eux; \
    if [ -n "$APT_MIRROR" ]; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        [ -f "$f" ] && sed -i "s/deb.debian.org/$APT_MIRROR/g; s/security.debian.org/$APT_MIRROR/g" "$f" || true; \
      done; \
    fi; \
    apt-get update \
    && apt-get install -y --no-install-recommends gcc python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir ${PIP_INDEX_URL:+-i "$PIP_INDEX_URL"} -r requirements.txt

COPY backend/ backend/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
