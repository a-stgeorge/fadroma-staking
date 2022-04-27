# was "FROM rust:1.46" for 1.0
FROM rust:1.57
ENV REGISTRY /usr/local/cargo/registry
ENV USER 1000
ENV GROUP 1000

RUN rustup target add wasm32-unknown-unknown
RUN apt update
RUN apt install -y binaryen sudo git clang nodejs
RUN rm -rf /var/lib/apt/lists/*
RUN mkdir -p "$REGISTRY"
WORKDIR /src

ADD ./Scrt_1_2_Build.sh /
#ADD ./Scrt_1_2_Build.js ./Scrt_1_2_Build.sh /
CMD node /Scrt_1_2_Build.js
