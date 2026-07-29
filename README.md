# OpenFaaS Function Editor Example

This repo contains a sample application that shows how OpenFaaS can be used to build a basic function editor that lets users edit, deploy and invoke custom code from the browser.

The sample app consists of a single-page [React](https://react.dev/) frontend and an [Express](https://expressjs.com/) backend API. In the Editor view, users can select a Node.js 24, Go middleware, or Python HTTP function template and edit its handler and dependency files. Clicking *Deploy* builds and publishes the function image, streams build progress into the editor, and deploys the function to OpenFaaS. The Test view can then be used to invoke the deployed function, inspect its response, and view its logs.

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

Basic authentication is supported and used to protect the editor and its API endpoints.

## Prerequisites

A Kubernetes cluster with OpenFaaS and the [OpenFaaS Function Builder API](https://docs.openfaas.com/openfaas-pro/builder/).

> The Function Builder API provides a simple REST API to create your functions from source code. See [Function Builder API docs](https://docs.openfaas.com/openfaas-pro/builder/) for installation instructions.

## Install with Helm

Deploy the editor with the Helm chart into the `openfaas` namespace. The chart
uses the OpenFaaS `basic-auth` and Function Builder `payload-secret` Secrets by
default. Create a Secret for signing editor sessions:

```sh
kubectl create secret generic function-editor-session \
  --namespace openfaas \
  --from-literal session-secret="$(openssl rand -hex 32)"
```

This Secret signs the cookie used to keep users logged in to the editor.

Set `config.imagePrefix` to a registry path where the Function Builder can push
function images, replacing `docker.io/your-name` below with your own registry:

```sh
helm upgrade --install function-editor \
  ./chart/function-editor \
  --namespace openfaas \
  --set config.imagePrefix=docker.io/your-name
```

Open the editor locally:

```sh
kubectl port-forward \
  --namespace openfaas \
  service/function-editor 3001:3001
```

Then visit `http://127.0.0.1:3001/` and sign in as `admin` using the OpenFaaS
gateway password.

## Development

To run the editor locally, install a recent version of
[Node.js](https://nodejs.org/en), then install the dependencies:

```sh
cd client
npm install
```

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

Port-forward the Function Builder and OpenFaaS gateway:

```sh
kubectl port-forward \
  --namespace openfaas \
  service/pro-builder 8081:8080

kubectl port-forward \
  --namespace openfaas \
  service/gateway 8080:8080
```

Save the Function Builder HMAC secret to `./client/.secrets/payload.txt`:

```sh
mkdir -p .secrets
kubectl get secret \
  --namespace openfaas \
  payload-secret \
  --output jsonpath='{.data.payload-secret}' \
  | base64 --decode > .secrets/payload.txt
```

Start the API server:

```sh
EDITOR_PASSWORD="choose-a-strong-password" \
SESSION_SECRET="$(openssl rand -hex 32)" \
IMAGE_PREFIX="docker.io/your-repo" \
npm run server
```

In another terminal, start the frontend:

```sh
npm run dev
```

Access the UI at: `http://127.0.0.1:5173/`
