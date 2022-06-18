# solana-jupiter-bot

> CAUTION! Use at Your own risk! I take no responsibility for your transactions!

## Install

```bash
$ git clone https://github.com/pmioduszewski/solana-jupiter-bot && cd solana-jupiter-bot
$ yarn
```

Set Your wallet private key in `.env` file

```js
SOLANA_WALLET_PRIVATE_KEY =
	hgq847chjjjJUPITERiiiISaaaAWESOMEaaANDiiiIwwWANNAbbbBErrrRICHh;
```

\*[optionally] set default RPC (it can be also set in wizard)

```js
SOLANA_WALLET_PRIVATE_KEY=hgq847chjjjJUPITERiiiISaaaAWESOMEaaANDiiiIwwWANNAbbbBErrrRICHh
DEFAULT_RPC=https://my-super-lazy-rpc.gov
```

## USAGE

```
$ solana-jupiter-bot:

  Usage
    $ yarn start
      This will open Config Wizard and start bot

    $ yarn trade
      Start Bot and Trade with latest config
```

Have fun!

## Hotkeys

While bot is running You can use some hotkeys that will change behaviour of bot or UI

`[H]` - show/hide Help

`[CTRL] + [C]` - obviously it will kill the bot

`[E]` - force execution with current setup & profit

`[R]` - revert back last swap

`[L]` - show/hide latency chart (of Jupiter `computeRoutes()`)

`[P]` - show/hide profit chart

`[T]` - show/hide trade history table \*_table isn't working yet_

> 🔴 This is raw init!
