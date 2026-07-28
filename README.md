# OpenFaaS Function Editor Example

This repo contains a sample application that shows how OpenFaaS can be used to build a basic function editor that lets users edit, deploy and invoke custom code from the browser.

The sample app consists of two parts: a frontend implemented as a single-page [React](https://react.dev/) application and an [Express](https://expressjs.com/) server for the backend API. Users can edit a Node.js function in the UI using a code editor. Clicking the *Publish & Deploy* button deploys the function to OpenFaaS. Once deployed, the *Test Function* page can be used to invoke the function, inspect responses and view the function logs.

This sample app is a basic implementation of the use case described in our blog post: [Integrate FaaS Capabilities into Your Platform with OpenFaaS](https://www.openfaas.com/blog/add-a-faas-capability/)

![Screenshot of the function editor UI](/images/function-editor.png)

## How it works

The application uses readily available OpenFaaS APIs to take user-supplied source code, produce an OpenFaaS function image and deploy it to OpenFaaS to get a custom HTTP endpoint.

OpenFaaS components used by the sample application:

- [Function Builder API](https://docs.openfaas.com/openfaas-pro/builder/)

    Allows code to be submitted, built, and deployed seamlessly.

    This REST API accepts a Docker build context and publishes a container image to a remote registry.

- [OpenFaaS REST API](https://docs.openfaas.com/reference/rest-api/)

    API for managing and invoking functions, secrets and namespaces.

    The OpenFaaS REST API has endpoints to create and manage tenant namespaces, deploy new functions, list and query existing ones, invoke them and query function logs.

**Overview**

1. User-supplied source code from the editor is sent to the backend's `/api/publish` endpoint.
2. The publish endpoint prepares the build context using a function template and invokes the [OpenFaaS Function Builder REST API](https://docs.openfaas.com/openfaas-pro/builder/).
3. The OpenFaaS Function Builder builds the container image for the function and publishes it to the configured registry.
4. After the function has been published, the `/api/deploy` endpoint is called. The backend server calls the [OpenFaaS API](https://docs.openfaas.com/reference/rest-api/) to deploy the function.
5. The function is ready to be invoked over HTTP.

A couple of additional OpenFaaS API endpoints are exposed through the backend server that allow users to invoke the function and inspect logs in the UI:

- `/api/invoke` - Proxies the function's HTTP endpoint.
- `/api/logs` - Uses the [OpenFaaS API's logs endpoint](https://docs.openfaas.com/reference/rest-api/#logs) to get the logs for the function.

The editor and every function API endpoint require a login. The login exchanges the
configured basic username and password for a signed, eight-hour, HttpOnly session
cookie. The password is never stored in browser storage.

## Quick start

Run the sample application locally.

### Prerequisites


A Kubernetes cluster with OpenFaaS and the [OpenFaaS Function Builder API](https://docs.openfaas.com/openfaas-pro/builder/).

> The Function Builder API provides a simple REST API to create your functions from source code. See [Function Builder API docs](https://docs.openfaas.com/openfaas-pro/builder/) for installation instructions.

You will need a recent version of [Node.js](https://nodejs.org/en) to run the sample app locally.

### Run the app

Install node_modules:

```sh
cd client
npm install
```

**Run the API server**

Configuration parameters:

- `IMAGE_PREFIX` - Image prefix used for pushing the images, e.g. `docker.io/openfaas`. Make sure your function builder [has the correct permissions](https://github.com/openfaas/faas-netes/tree/master/chart/pro-builder#registry-authentication) to push to this registry.
- `BUILDER_URL` - URL of the function builder API (default: http://127.0.0.1:8081)
- `BUILDER_PAYLOAD_SECRET` - Path to the file containing the HMAC signing secret created during the installation of the function builder. (default: ".secrets/payload.txt")
- `GATEWAY_URL` - URL of the OpenFaaS Gateway (default: http://127.0.0.1:8080)
- `BASIC_AUTH_SECRET` - Basic auth secret to authenticate with the OpenFaaS Gateway (default: ".secrets/basic-auth-password.txt")
- `EDITOR_USERNAME` - Username for the function editor login (default: `admin`)
- `EDITOR_PASSWORD` - Password for the function editor login (required)
- `SESSION_SECRET` - Random secret used to sign login cookies (required). Use at least 32 random bytes.
- `SECURE_COOKIES` - Set to `true` when the editor is served over HTTPS to add the cookie's `Secure` flag (default: `false`)
- `PORT` - API server port (default: `3001`)

- [Function Builder examples](https://github.com/openfaas/function-builder-examples)

Make sure the pro-builder is port-forwarded to port 8081 on the local host.

```sh
kubectl port-forward \
    -n openfaas \
    svc/pro-builder 8081:8080
```

Save the HMAC signing secret created during the installation to a file `./client/.secrets/payload.txt`.

```sh
kubectl get secret \
    -n openfaas payload-secret -o jsonpath='{.data.payload-secret}' \
    | base64 --decode \
    > .secrets/payload.txt
```

Port forward the OpenFaaS Gateway:

```sh
kubectl port-forward \
    -n openfaas \
    svc/gateway 8080:8080
```

Start the server:

```sh
EDITOR_PASSWORD="choose-a-strong-password" \
SESSION_SECRET="$(openssl rand -hex 32)" \
IMAGE_PREFIX="docker.io/your-repo" \
npm run server
```

**Run the frontend**

Start the frontend server:

```sh
npm run dev
```

Access the UI at: `http://127.0.0.1:5173/`

### Run as a container

The container runs the API and serves the compiled editor UI from the same
process on port `3001`.

```sh
docker build -t function-editor .

docker run --rm -p 3001:3001 \
  -e EDITOR_PASSWORD="choose-a-strong-password" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e IMAGE_PREFIX="docker.io/your-repo" \
  -e BUILDER_URL="http://builder.example.com" \
  -e GATEWAY_URL="http://gateway.example.com" \
  -v "$PWD/client/.secrets:/app/.secrets:ro" \
  function-editor
```

Open `http://127.0.0.1:3001/`. When exposing the container through an HTTPS
reverse proxy, also set `SECURE_COOKIES=true`.

### Deploy to Kubernetes

Build and push the editor image to ttl.sh. The `24h` tag expires after 24 hours,
so repush it when needed.

```sh
docker build -t ttl.sh/welteki/function-editor-demo-auth:24h .
docker push ttl.sh/welteki/function-editor-demo-auth:24h
```

Create a namespace and a Secret containing the editor credentials plus the
existing OpenFaaS gateway and builder secrets:

```sh
kubectl create namespace function-editor

kubectl create secret generic function-editor-secrets \
  --namespace function-editor \
  --from-literal editor-password="choose-a-strong-password" \
  --from-literal session-secret="$(openssl rand -hex 32)" \
  --from-literal builder-payload-secret="$(
    kubectl get secret payload-secret \
      --namespace openfaas \
      --output jsonpath='{.data.payload-secret}' | base64 --decode
  )" \
  --from-literal basic-auth-password="$(
    kubectl get secret basic-auth \
      --namespace openfaas \
      --output jsonpath='{.data.basic-auth-password}' | base64 --decode
  )"
```

Install the chart:

```sh
helm upgrade --install function-editor \
  ./chart/function-editor \
  --namespace function-editor
```

Open the editor locally:

```sh
kubectl port-forward \
  --namespace function-editor \
  service/function-editor 3001:3001
```

Then visit `http://127.0.0.1:3001/`. Override settings such as the gateway,
builder, image tag, or service type in
[`chart/function-editor/values.yaml`](chart/function-editor/values.yaml).
