# troi-library

Interact with troi api v2 without hassle. Originally build by [@nfelger](https://github.com/nfelger).

# Setup

```sh
npm i troi-library --save
```

# Usage

```js
import TroiApiService from "troi-library";

const troiUrl = "https://<MY_ORG>.troi.software/api/v2/rest";

const troiApi = new TroiApiService(troiUrl, username, password);
await troiApi.initialize();

troiApi.getCalculationPositions().then((pos) => {
  // ...
});
```
