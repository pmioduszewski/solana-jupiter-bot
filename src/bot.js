console.clear();

require("dotenv").config();
const { PublicKey } = require("@solana/web3.js");
const chalk = require("chalk");
const fs = require("fs");
const { setup } = require("./setup");
const ui = require("cliui")({ width: 140 });
const chart = require("asciichart");
const moment = require("moment");
const { calculateProfit, toDecimal, toNumber } = require("./utils");
const { handleExit } = require("./exit");
const keypress = require("keypress");
const ora = require("ora-classic");
const { clearInterval } = require("timers");

// read config.json file
const configSpinner = ora({
	text: "Loading config...",
	discardStdin: false,
}).start();
const config = JSON.parse(fs.readFileSync("./config.json"));
configSpinner.succeed("Config loaded!");

// cache
const cache = {
	startTime: new Date(),
	firstSwap: true,
	firstSwapInQueue: false,
	queue: {},
	queueThrottle: 1,
	sideBuy: true,
	iteration: 0,
	iterationPerMinute: {
		start: performance.now(),
		value: 0,
		counter: 0,
	},
	initialBalance: {
		tokenA: 0,
		tokenB: 0,
	},
	initialBalance: {
		tokenA: 0,
	},
	currentBalance: {
		tokenA: 0,
		tokenB: 0,
	},
	currentProfit: {
		tokenA: 0,
		tokenB: 0,
	},
	lastBalance: {
		tokenA: 0,
		tokenB: 0,
	},
	profit: {
		tokenA: 0,
		tokenB: 0,
	},
	maxProfitSpotted: {
		buy: 0,
		sell: 0,
	},
	tradeCounter: {
		buy: { success: 0, fail: 0 },
		sell: { success: 0, fail: 0 },
	},
	ui: {
		defaultColor: config.ui.defaultColor,
		showPerformanceOfRouteCompChart: false,
		showProfitChart: true,
		showTradeHistory: true,
		hideRpc: false,
		showHelp: true,
	},
	chart: {
		spottedMax: {
			buy: new Array(120).fill(0),
			sell: new Array(120).fill(0),
		},
		performanceOfRouteComp: new Array(120).fill(0),
	},
	hotkeys: {
		e: false,
		r: false,
	},
	tradingEnabled: config.tradingEnabled,
	swappingRightNow: false,
	tradingMode: config.tradingMode,
	tradeHistory: [],
	performanceOfTxStart: 0,
};

const swap = async (jupiter, route) => {
	try {
		// console.log("SWAPPING...");

		const performanceOfTxStart = performance.now();
		cache.performanceOfTxStart = performanceOfTxStart;

		// console.log("before swap", route);

		const { execute } = await jupiter.exchange({
			routeInfo: route,
		});
		const result = await execute();

		const test = JSON.parse(JSON.stringify(result));
		// console.log("result of swap: ", result);
		// console.log("result of swap parsed: ", test);

		const performanceOfTx = performance.now() - performanceOfTxStart;

		return [result, performanceOfTx];
	} catch (error) {
		console.log("Swap error: ", error);
	}
};

const failedSwapHandler = (tx, tradeEntry, route) => {
	// console.log("SWAPPING FAILED...");
	const msg = tx.error.message;

	// update counter
	cache.tradeCounter[cache.sideBuy ? "buy" : "sell"].fail++;

	// update trade history
	config.storeFailedTxInHistory;

	// update trade history
	let tempHistory = cache.tradeHistory || [];
	// console.log("tempHistory ", tempHistory);
	tempHistory.push(tradeEntry);
	// console.log("tempHistory ", tempHistory);
	cache.tradeHistory = tempHistory;
	// console.log("cache.tradeHistory ", cache.tradeHistory);

	// add AMM to blockedAMMs
	const marketInfos = JSON.parse(JSON.stringify(route.marketInfos, null, 2));
	// for (const market of marketInfos) {
	// 	if (msg.toLowerCase().includes("unknown"))
	// 		cache.blockedAMMs[market.amm.id] = msg;
	// }
};

const successSwapHandler = (tx, tradeEntry, tokenA, tokenB) => {
	// console.log("SWAPPING SUCCESS...");

	// update counter
	cache.tradeCounter[cache.sideBuy ? "buy" : "sell"].success++;

	// update balance
	cache.lastBalance[cache.sideBuy ? "tokenB" : "tokenA"] = cache.firstSwap
		? tx.outputAmount
		: cache.currentBalance[cache.sideBuy ? "tokenB" : "tokenA"];

	cache.currentBalance[cache.sideBuy ? "tokenB" : "tokenA"] = tx.outputAmount;

	tradeEntry.inAmount = tx.inputAmount;
	tradeEntry.outAmount = tx.outputAmount;

	// calculate profit

	const lastBalance = cache.lastBalance[cache.sideBuy ? "tokenB" : "tokenA"];

	const profit = calculateProfit(lastBalance, tx.outputAmount);

	console.log("lastBalance ", lastBalance);

	console.log("profit ", profit);

	cache.currentProfit[cache.sideBuy ? "tokenA" : "tokenB"] = profit;

	// update trade history
	let tempHistory = cache.tradeHistory || [];
	tempHistory.push(tradeEntry);
	cache.tradeHistory = tempHistory;

	// first swap done
	if (cache.firstSwap) {
		cache.firstSwap = false;
		cache.firstSwapInQueue = false;
	}
};

const pingpongMode = async (jupiter, tokenA, tokenB) => {
	cache.iteration++;
	const date = new Date();
	const i = cache.iteration;
	cache.queue[i] = -1;
	if (cache.firstSwap) cache.firstSwapInQueue = true;
	try {
		// calculate & update iteration per minute
		const iterationTimer =
			(performance.now() - cache.iterationPerMinute.start) / 1000;

		if (iterationTimer >= 60) {
			cache.iterationPerMinute.value = Number(
				cache.iterationPerMinute.counter.toFixed()
			);
			cache.iterationPerMinute.start = performance.now();
			cache.iterationPerMinute.counter = 0;
		} else cache.iterationPerMinute.counter++;

		// Calculate amount that will be used for trade
		const amountToTrade = cache.firstSwap
			? cache.initialBalance.tokenA
			: cache.currentBalance[cache.sideBuy ? "tokenA" : "tokenB"];
		const baseAmount = cache.lastBalance[cache.sideBuy ? "tokenB" : "tokenA"];

		// console.log("AMOUNT TO TRADE: ", amountToTrade);
		// console.log("BASE AMOUNT: ", baseAmount);

		// default slippage
		const slippage = 1;

		// set input / output token
		const inputToken = cache.sideBuy ? tokenA : tokenB;
		const outputToken = cache.sideBuy ? tokenB : tokenA;

		// check current routes
		const performanceOfRouteCompStart = performance.now();
		const routes = await jupiter.computeRoutes({
			inputMint: new PublicKey(inputToken.address),
			outputMint: new PublicKey(outputToken.address),
			inputAmount: amountToTrade,
			slippage,
			forceFeech: true,
		});

		// update status as OK
		cache.queue[i] = 0;

		const performanceOfRouteComp =
			performance.now() - performanceOfRouteCompStart;

		// choose first route
		const route = await routes.routesInfos[0];

		// update slippage with "profit or kill" slippage
		const profitOrKillSlippage = cache.firstSwap
			? route.outAmountWithSlippage
			: cache.lastBalance[cache.sideBuy ? "tokenB" : "tokenA"] * 1.01; // 1%

		// calculate profitability

		let simulatedProfit = cache.firstSwap
			? 0
			: calculateProfit(baseAmount, await route.outAmount);

		// console.log("route.inAmount ", route.inAmount);
		// console.log("profitOrKillSlippage ", profitOrKillSlippage);
		// console.log("1 simulatedProfit ", simulatedProfit);

		// store max profit spotted
		if (
			simulatedProfit > cache.maxProfitSpotted[cache.sideBuy ? "buy" : "sell"]
		) {
			cache.maxProfitSpotted[cache.sideBuy ? "buy" : "sell"] = simulatedProfit;
		}

		printToConsole(
			date,
			i,
			performanceOfRouteComp,
			inputToken,
			outputToken,
			tokenA,
			tokenB,
			route,
			simulatedProfit,
			baseAmount
		);

		// check profitability and execute tx
		let tx, performanceOfTx;
		if (
			!cache.swappingRightNow &&
			(cache.firstSwap ||
				cache.hotkeys.e ||
				cache.hotkeys.r ||
				simulatedProfit >= config.minPercProfit)
		) {
			// hotkeys
			if (cache.hotkeys.e) {
				console.log("[E] PRESSED - EXECUTION FORCED BY USER!");
				cache.hotkeys.e = false;
			}
			if (cache.hotkeys.r) {
				console.log("[R] PRESSED - REVERT BACK SWAP!");
			}

			if (cache.tradingEnabled || cache.hotkeys.r) {
				cache.swappingRightNow = true;
				// store trade to the history
				let tradeEntry = {
					date: date,
					buy: cache.sideBuy,
					inputToken: inputToken.symbol,
					outputToken: outputToken.symbol,
					inAmount: route.inAmount,
					expectedOutAmount: route.outAmount,
					expectedProfit: simulatedProfit,
				};

				// start refreshing status
				const printTxStatus = setInterval(() => {
					if (cache.swappingRightNow) {
						printToConsole(
							date,
							i,
							performanceOfRouteComp,
							inputToken,
							outputToken,
							tokenA,
							tokenB,
							route,
							simulatedProfit,
							baseAmount
						);
					}
				}, 500);

				[tx, performanceOfTx] = await swap(jupiter, route);

				// stop refreshing status
				clearInterval(printTxStatus);

				const profit = cache.firstSwap
					? 0
					: calculateProfit(
							cache.currentBalance[cache.sideBuy ? "tokenB" : "tokenA"],
							tx.outputAmount
					  );

				tradeEntry = {
					...tradeEntry,
					outAmount: tx.outputAmount,
					profit,
					performanceOfTx,
					error: tx.error?.message || null,
				};

				// handle TX results
				if (tx.error) failedSwapHandler(tx, tradeEntry, route);
				else {
					if (cache.hotkeys.r) {
						console.log("[R] - REVERT BACK SWAP - SUCCESS!");
						cache.tradingEnabled = false;
						console.log("TRADING DISABLED!");
						cache.hotkeys.r = false;
					}
					successSwapHandler(tx, tradeEntry, tokenA, tokenB);
				}
			}
		}

		// save route Object in ./temp/route.json file
		// fs.writeFileSync("./temp/route.json", JSON.stringify(route, null, 2));

		if (tx) {
			if (!tx.error) {
				// change side
				cache.sideBuy = !cache.sideBuy;
			}
			cache.swappingRightNow = false;
		}

		printToConsole(
			date,
			i,
			performanceOfRouteComp,
			inputToken,
			outputToken,
			tokenA,
			tokenB,
			route,
			simulatedProfit,
			baseAmount
		);
	} catch (error) {
		cache.queue[i] = 1;
		console.log(error);
	} finally {
		delete cache.queue[i];
	}
};

const watcher = async (jupiter, tokenA, tokenB) => {
	if (!cache.swappingRightNow) {
		if (cache.firstSwap && Object.keys(cache.queue).length === 0) {
			const firstSwapSpinner = ora({
				text: "Executing first swap...",
				discardStdin: false,
			}).start();
			await pingpongMode(jupiter, tokenA, tokenB);
			if (cache.firstSwap) firstSwapSpinner.fail("First swap failed!");
			else firstSwapSpinner.stop();
		} else if (
			!cache.firstSwap &&
			!cache.firstSwapInQueue &&
			Object.keys(cache.queue).length < cache.queueThrottle &&
			cache.tradingMode === "pingpong"
		) {
			await pingpongMode(jupiter, tokenA, tokenB);
		}
	}
};

const run = async () => {
	try {
		const setupSpinner = ora({
			text: "Setting up...",
			discardStdin: false,
		}).start();
		const { jupiter, tokenA, tokenB, blockedAMMs } = await setup(config);
		setupSpinner.succeed("Setup done!");

		// load blocked AMMs to cache
		cache.blockedAMMs = blockedAMMs;

		// set initial & last balance for tokenA
		cache.initialBalance.tokenA = toNumber(config.tradeSize, tokenA.decimals);
		cache.currentBalance.tokenA = cache.initialBalance.tokenA;
		cache.lastBalance.tokenA = cache.initialBalance.tokenA;

		setInterval(() => watcher(jupiter, tokenA, tokenB), config.minInterval);

		// hotkeys
		keypress(process.stdin);

		process.stdin.on("keypress", function (ch, key) {
			// console.log('got "keypress"', key);
			if (key && key.ctrl && key.name == "c") {
				cache.swappingRightNow = true; // stop all trades
				console.log("[CTRL] + [C] PRESS AGAIN TO EXIT!");
				process.stdin.pause();
				process.stdin.setRawMode(false);
				process.stdin.resume();
			}

			// [E] - forced execution
			if (key && key.name === "e") {
				cache.hotkeys.e = true;
			}

			// [R] - revert back swap
			if (key && key.name === "r") {
				cache.hotkeys.r = true;
			}

			// [P] - switch profit chart visibility
			if (key && key.name === "p") {
				cache.ui.showProfitChart = !cache.ui.showProfitChart;
			}

			// [L] - switch performance chart visibility
			if (key && key.name === "l") {
				cache.ui.showPerformanceOfRouteCompChart =
					!cache.ui.showPerformanceOfRouteCompChart;
			}

			// [H] - switch trade history visibility
			if (key && key.name === "t") {
				cache.ui.showTradeHistory = !cache.ui.showTradeHistory;
			}

			// [I] - incognito mode (hide RPC)
			if (key && key.name === "i") {
				cache.ui.hideRpc = !cache.ui.hideRpc;
			}

			// [H] - switch help visibility
			if (key && key.name === "h") {
				cache.ui.showHelp = !cache.ui.showHelp;
			}
		});

		process.stdin.setRawMode(true);
		process.stdin.resume();
	} catch (error) {
		console.log(error);
	} finally {
		handleExit(config, cache);
	}
};

run();

function printToConsole(
	date,
	i,
	performanceOfRouteComp,
	inputToken,
	outputToken,
	tokenA,
	tokenB,
	route,
	simulatedProfit,
	baseAmount
) {
	try {
		// update max profitability spotted chart
		if (cache.ui.showProfitChart) {
			let spottetMaxTemp =
				cache.chart.spottedMax[cache.sideBuy ? "buy" : "sell"];
			spottetMaxTemp.shift();
			spottetMaxTemp.push(
				simulatedProfit === Infinity
					? 0
					: parseFloat(simulatedProfit.toFixed(2))
			);
			cache.chart.spottedMax.buy = spottetMaxTemp;
		}

		// update performance chart
		if (cache.ui.showPerformanceOfRouteCompChart) {
			let performanceTemp = cache.chart.performanceOfRouteComp;
			performanceTemp.shift();
			performanceTemp.push(parseInt(performanceOfRouteComp.toFixed()));
			cache.chart.performanceOfRouteComp = performanceTemp;
		}

		// check swap status
		let swapStatus;
		if (cache.swappingRightNow) {
			swapStatus = performance.now() - cache.performanceOfTxStart;
		}

		// refresh console before print
		console.clear();
		ui.resetOutput();

		// show HOTKEYS HELP
		if (cache.ui.showHelp) {
			ui.div(
				chalk.gray("[H] - show/hide help"),
				chalk.gray("[CTRL]+[C] - exit"),
				chalk.gray("[I] - incognito RPC")
			);
			ui.div(
				chalk.gray("[L] - show/hide latency chart"),
				chalk.gray("[P] - show/hide profit chart"),
				chalk.gray("[T] - show/hide trade history")
			);
			ui.div(
				chalk.gray("[E] - force execution"),
				chalk.gray("[R] - revert back swap"),
				chalk.gray(" ")
			);
			ui.div(" ");
		}

		ui.div(
			{
				text: `TIMESTAMP: ${chalk[cache.ui.defaultColor](
					date.toLocaleString()
				)}`,
			},
			{
				text: `I: ${
					i % 2 === 0
						? chalk[cache.ui.defaultColor].bold(i)
						: chalk[cache.ui.defaultColor](i)
				} | ${chalk.bold[cache.ui.defaultColor](
					cache.iterationPerMinute.value
				)} i/min`,
			},
			{
				text: `RPC: ${chalk[cache.ui.defaultColor](
					cache.ui.hideRpc
						? `${config.rpc[0].slice(0, 5)}...${config.rpc[0].slice(-5)}`
						: config.rpc[0]
				)}`,
			}
		);

		ui.div(
			{
				text: `STARTED: ${chalk[cache.ui.defaultColor](
					moment(cache.startTime).fromNow()
				)}`,
			},
			{
				text: `LOOKUP (ROUTE): ${chalk.bold[cache.ui.defaultColor](
					performanceOfRouteComp.toFixed()
				)} ms`,
			},
			{
				text: `MIN INTERVAL: ${chalk[cache.ui.defaultColor](
					config.minInterval
				)} ms QUEUE: ${chalk[cache.ui.defaultColor](
					Object.keys(cache.queue).length
				)}/${chalk[cache.ui.defaultColor](cache.queueThrottle)}`,
			}
		);

		ui.div(
			" ",
			" ",
			Object.values(cache.queue)
				.map(
					(v) => `${chalk[v === 0 ? "green" : v < 0 ? "yellow" : "red"]("●")}`
				)
				.join(" ")
		);

		if (cache.ui.showPerformanceOfRouteCompChart)
			ui.div(
				chart.plot(cache.chart.performanceOfRouteComp, {
					padding: " ".repeat(10),
					height: 5,
				})
			);

		ui.div("");
		ui.div(chalk.gray("-".repeat(140)));

		ui.div(
			`TRADING: ${chalk.bold[cache.ui.defaultColor](
				inputToken.symbol
			)} -> ${chalk.bold[cache.ui.defaultColor](outputToken.symbol)}`,
			{
				text: cache.swappingRightNow
					? chalk.bold[
							swapStatus < 45000
								? "greenBright"
								: swapStatus < 60000
								? "yellowBright"
								: "redBright"
					  ](`SWAPPING ... ${swapStatus.toFixed()} ms`)
					: " ",
			}
		);
		ui.div("");

		ui.div("BUY", "SELL", " ", " ");

		ui.div(
			{
				text: `SUCCESS : ${chalk.bold.green(cache.tradeCounter.buy.success)}`,
			},
			{
				text: `SUCCESS: ${chalk.bold.green(cache.tradeCounter.sell.success)}`,
			},
			{
				text: " ",
			},
			{
				text: " ",
			}
		);
		ui.div(
			{
				text: `FAIL: ${chalk.bold.red(cache.tradeCounter.buy.fail)}`,
			},
			{
				text: `FAIL: ${chalk.bold.red(cache.tradeCounter.sell.fail)}`,
			},
			{
				text: " ",
			},
			{
				text: " ",
			}
		);
		ui.div("");

		ui.div(
			{
				text: `IN: ${chalk.yellowBright(
					toDecimal(route.inAmount, inputToken.decimals)
				)} ${chalk[cache.ui.defaultColor](inputToken.symbol)}`,
			},
			{
				text: `PROFIT: ${chalk[simulatedProfit > 0 ? "greenBright" : "red"](
					simulatedProfit.toFixed(2)
				)} %`,
			},
			{
				text: `OUT: ${chalk[simulatedProfit > 0 ? "greenBright" : "red"](
					toDecimal(route.outAmount, outputToken.decimals)
				)} ${chalk[cache.ui.defaultColor](outputToken.symbol)}`,
			},
			{
				text: `NOMINAL SIZE: ${chalk[cache.ui.defaultColor](
					`${config.tradeSize} ${inputToken.symbol}`
				)}`,
			},
			{ text: `` }
		);

		ui.div(" ");

		ui.div("CURRENT BALANCE", "LAST BALANCE", " ", " ");

		ui.div(
			`${chalk.yellowBright(
				toDecimal(cache.currentBalance.tokenA, tokenA.decimals)
			)} ${chalk[cache.ui.defaultColor](tokenA.symbol)}`,

			`${chalk.yellowBright(
				toDecimal(cache.lastBalance.tokenA, tokenA.decimals)
			)} ${chalk[cache.ui.defaultColor](tokenA.symbol)}`,

			`PROFIT: ${chalk[cache.currentProfit.tokenA > 0 ? "greenBright" : "red"](
				cache.currentProfit.tokenA.toFixed(2)
			)} %`,
			" "
		);

		ui.div(
			`${chalk.yellowBright(
				toDecimal(cache.currentBalance.tokenB, tokenB.decimals)
			)} ${chalk[cache.ui.defaultColor](tokenB.symbol)}`,

			`${chalk.yellowBright(
				toDecimal(cache.lastBalance.tokenB, tokenB.decimals)
			)} ${chalk[cache.ui.defaultColor](tokenB.symbol)}`,

			`PROFIT: ${chalk[cache.currentProfit.tokenB > 0 ? "greenBright" : "red"](
				cache.currentProfit.tokenA.toFixed(2)
			)} %`,
			" "
		);

		ui.div(chalk.gray("-".repeat(140)));
		ui.div("");

		if (cache.ui.showProfitChart) {
			ui.div(
				chart.plot(cache.chart.spottedMax[cache.sideBuy ? "buy" : "sell"], {
					padding: " ".repeat(10),
					height: 4,
					colors: [simulatedProfit > 0 ? chart.lightgreen : chart.lightred],
				})
			);

			ui.div("");
		}

		ui.div(
			{
				text: `MAX (BUY): ${chalk[cache.ui.defaultColor](
					cache.maxProfitSpotted.buy.toFixed(2)
				)} %`,
			},
			{
				text: `MAX (SELL): ${chalk[cache.ui.defaultColor](
					cache.maxProfitSpotted.sell.toFixed(2)
				)} %`,
			},
			{ text: " " }
		);

		ui.div("");
		ui.div(chalk.gray("-".repeat(140)));
		ui.div("");

		if (cache.ui.showTradeHistory) {
			ui.div(
				{ text: `TIMESTAMP` },
				{ text: `SIDE` },
				{ text: `IN` },
				{ text: `OUT` },
				{ text: `PROFIT` },
				{ text: `ERROR` }
			);
		}
		ui.div("");
		console.log(ui.toString());

		delete swapStatus;
		// console.log("route.outAmount", route.outAmount);
		// console.log("baseAmount ", baseAmount);
		// console.log("simulatedProfit: ", simulatedProfit);
		// console.log("cache.currentBalance.tokenA: ", cache.currentBalance.tokenA);
		// console.log("cache.currentBalance.tokenB: ", cache.currentBalance.tokenB);
	} catch (error) {
		console.log(error);
	}
}
