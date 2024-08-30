## How to Install and Deploy Inflect

### Prerequisites

- [Docker](https://www.docker.com/) version 24+
- [kubectl](https://kubernetes.io/docs/tasks/tools/#kubectl) version 1.28+
- [Node](https://nodejs.org/en) version 20.0+ and [npm](https://www.npmjs.com/) version 10+
- Have your Kafka broker URLs, Kafka API keys, and (optional) Schema Registry API keys ready

### 1. Clone the stream processor repository

```sh [npm]
$ git clone https://github.com/inflect-framework/stream-processor.git
```

### 2. Install npm packages
```sh [npm]
$ cd stream-processor
$ npm i
```

### 3. Run make deploy
```sh [npm]
$ make deploy
```