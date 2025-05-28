# OpenFaaS Function Editor Example

This repo contains a sample application that shows how OpenFaaS can be used to build a basic function editor that let's users edit, deploy and invoke custom code from the browser.

The sample app consists of two parts. A frontend implemented as a single page [React](https://react.dev/) application and [Express](https://expressjs.com/) server for the backend API. Users can edit a Node.js function in the UI using a code editor. Clicking the *Publish & Deploy* button deploys the function to OpenFaaS. Once deployed the *Test Function* page can be used to invoke the function, inspect responses and view the function logs.

It sample app is a basic implementation of the use case described in the our blog post: [Integrate FaaS Capabilities into Your Platform with OpenFaaS](https://www.openfaas.com/blog/add-a-faas-capability/)

![Screenshot of the function editor UI](/images/function-editor.png)

## How it works

The application uses readily available OpenFaaS APIs to take user-supplied source-code, produce an OpenFaaS function image and deploy it to OpenFaaS to get a custom HTTP endpoint.

OpenFaaS components used by the sample application:

- [Function Builder API](https://docs.openfaas.com/openfaas-pro/builder/)

    Allows code to be submitted, built, and deployed seamlessly.

    This REST API accepts a Docker build context and publishes a container image to a remote registry.

- [OpenFaaS REST API](https://docs.openfaas.com/reference/rest-api/)

    API for managing and invoking functions, secrets and namespaces.

    The OpenFaaS REST API has endpoints to create and manage tenant namespaces, to deploy new functions, list and query existing ones, invoke them and query function logs.

**Overview**

1. User supplied source-code from the editor is send to the backends `/api/publish` endpoint.
2. The publish endpoint prepares the build context using a function template and invokes the [OpenFaaS Function Builder REST API](https://docs.openfaas.com/openfaas-pro/builder/).
3. The OpenFaaS function builder builds the container image for the function and published it to the configured registry.
4. After the function has been published the `/api/publish` endpoint is called. The backend server calls the [OpenFaaS API](https://docs.openfaas.com/reference/rest-api/) to deploy the function.
5. The function is ready to be invoked over HTTP.

A couple of additional OpenFaaS API endpoints are exposed through the backed server that allow users to invoke the function and inspect logs in the UI:

- `/api/invoke` - Proxies the functions HTTP endpoint.
- `/api/logs` - Uses the [OpenFaaS APIs logs endpoint](https://docs.openfaas.com/reference/rest-api/#logs) to get the logs for the function. 

> Note: Authentication for the backend API as this is out of scope for this examples. Keep in mind the for a production ready app some form of authentication should be added to protect the API endpoint.

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

- `IMAGE_PREFIX` - Image prefix used for pushing the images, e.g. `docker.io/openfaas`. Make sur your function builder [has the correct permissions](https://github.com/openfaas/faas-netes/tree/master/chart/pro-builder#registry-authentication) to push to this registry.
- `BUILDER_URL` - URl of the function builder API (default: http://127.0.0.1:8081)
- `BUILDER_PAYLOAD_SECRET` - Path the file containing the HMAC signing secret created during the installation of the function builder. (default: ".secrets/payload.txt")
- `GATEWAY_URL` - URL of the OpenFaaS Gateway (default: http://127.0.0.1:8080)
- `BASIC_AUTH_SECRET` - Basic auth secret to authenticate with the OpenFaaS Gateway (default: ".secrets/basic-auth-password.txt")

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
IMAGE_PREFIX="docker.io/your-repo" \
npm run server
```

**Run the frontend**

Start the frontend server:

```sh
npm run dev
```

Access the UI at: `http://127.0.0.1:5173/`
