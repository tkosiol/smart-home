# adapters

The contract between the core and the gateway adapters: neutral events in, canonical values out (`GatewayAdapter`). The `AdapterRegistry` holds the loaded adapters by kind and is fixed once the app is built (`AdaptersModule.forRoot`). It depends on nothing but `@smart/contracts`.
