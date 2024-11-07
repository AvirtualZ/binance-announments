import axios from "axios";
import _ from "lodash";
import moment from "moment";
import config from './config.js';

export default class Binance {
    static async CheckAnnouncements(): Promise<string[]> {
        console.log("检查币安公告", moment().format('YYYY-MM-DD HH:mm:ss'));
        const url = `https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&catalogId=48&pageSize=20`;

        const tokens: string[] = [];
        try {
            const result: any = await axios({
                method: 'get',
                url: config.proxy.url,
                headers: {
                    'lang': 'zh-CN'
                },
                params: {
                    'url': url,
                    'apikey': config.proxy.apikey,
                    'custom_headers': 'true',
                },
            });

            const announcements = result.data["data"]["catalogs"][0]["articles"];
            for (const announcement of announcements) {
                const title = announcement.title;
                const publishDate = moment(announcement.releaseDate).format('YYYY-MM-DD HH:mm:ss');
                const id = announcement.id;
                // console.log("发布日期:", publishDate);
                // console.log("文章链接:", articleUrl);

                if (title.includes("合约") && title.includes("上线")) {
                    const titleParts = title.split("币安合约将上线");
                    if (titleParts.length > 1) {
                        const token = titleParts[1].split(" ")[0];
                        // console.log("重要公告:", title, id, publishDate);
                        // console.log("提取的代币:", token);
                        const isProcessed = await config.redis.get(token);
                        if (isProcessed) {
                            // console.log(`代币 ${token} 已经处理过，跳过`);
                            continue;
                        }
                        // console.log("公告标题:", announcement);
                        // 推送lark
                        await this.sendLarkMessage("币安公告", announcement.title+"\n"+publishDate);
                        tokens.push(token);
                    }
                }
            }
        } catch (error) {
            console.error("错误详情:", error);
            await this.sendLarkMessage("检查币安公告时出错", `检查币安公告时出错, 错误信息: ${error}`);
            return tokens;
        }
        
        return tokens;
    }

    static async CheckAndPlaceOrder(tokens: string[]) {
        console.log('tokens:', tokens);
        for (const token of tokens) {
            // 检查OKX交易所
            const isListedOnOKX = await this.checkOKXListing(token);
            if (isListedOnOKX) {
                console.log(`代币 ${token} 在OKX上市了永续合约111111111111111`);
                await this.placeLongOrderOKX(token);
            } else {
                // 检查Gate.io交易所
                const isListedOnGateIO = await this.checkGateIOListing(token);
                if (isListedOnGateIO) {
                    console.log(`代币 ${token} 在Gate.io上市了永续合约222222222222222`);
                    await this.placeLongOrderGateIO(token);
                } else {
                    console.log(`代币 ${token} 未在OKX或Gate.io上市`);
                    await this.sendLarkMessage("币安公告", `代币 ${token} 未在OKX或Gate.io上市`);
                }
            }
            await config.redis.set(token, 'processed');
        }
    }

    static async checkOKXListing(token: string): Promise<boolean> {
        try {
            config.okx.options['defaultType'] = 'future';
            await config.okx.loadMarkets();
            const symbol = `${token}/USDT:USDT`;
            return symbol in config.okx.markets && (config.okx.markets[symbol].future || config.okx.markets[symbol].linear);
        } catch (error) {
            console.error(`检查OKX上 ${token} 的永续合约时出错:`, error);
            return false;
        }
    }

    static async checkGateIOListing(token: string): Promise<boolean> {
        try {
                config.gateio.options['defaultType'] = 'future';
            await config.gateio.loadMarkets();
            const symbol = `${token}/USDT:USDT`;
            if (symbol in config.gateio.markets) {
                return config.gateio.markets[symbol].future || config.gateio.markets[symbol].linear;
            } else {
                return false;
            }
        } catch (error) {
            console.error(`检查Gate.io上 ${token} 的永续合约时出错:`, error);
            return false;
        }
    }

    static async placeLongOrderOKX(token: string) {
        try {
                const exchange = config.okx;
            const symbol = `${token}/USDT:USDT`;
            // 获取账户余额
            const balance = await exchange.fetchBalance();
            const availableUSDT = balance.USDT?.free || 0;
            console.log(`OKX可用USDT余额: ${availableUSDT}`);

            const amount = availableUSDT*0.9; // 设置合适的下单数量
            const leverage = 3; // 设置5倍杠杆, 其他倍数设置不成功，鬼知道为什么

            // 设置杠杆和逐仓模式
            // await exchange.setPositionMode(true);  // 设置为双向持仓模式
            await exchange.privatePostAccountSetPositionMode({ 'posMode': 'long_short_mode' });

            await exchange.setLeverage(leverage, symbol, {
                'mgnMode': 'isolated',
                'posSide': 'long',
            });

            // 获取当前市场价格
            const ticker = await exchange.fetchTicker(symbol);
            const price = ticker.last;
            // 获取每张合约的价值
            const contractSize = exchange.market(symbol)?.contractSize ?? 1;
            const contractValue = price ? price * contractSize : 0;
            console.log(`每张合约的价值: ${contractValue} USDT`);

            // 计算实际下单数量（以保证金金额为基准）
            const rawAmount = contractValue > 0 ? amount / contractValue * leverage : 0;
            const actualAmount = Math.floor(rawAmount);

            console.log("实际下单数量:", actualAmount, amount, price, leverage);
            if (actualAmount > 0) {
                // 下市价开仓单
                const order = await exchange.createOrder(symbol, 'market', 'buy', actualAmount, undefined,{
                    'mgnMode': 'isolated',
                    'posSide': 'long',
                });
                var logMsg = `在OKX为 ${token} 使用逐仓模式下了${leverage}倍多单，订单信息: ${JSON.stringify(order)}`;
                
                // 获取开仓价格
                const openPrice = order.price || (await exchange.fetchTicker(symbol)).last;
                if (openPrice) {
                    // 计算止盈价格 (上涨20%)
                    const takeProfitPrice = openPrice * 1.1;
                    
                    // 下止盈限价单
                    const tpOrder = await exchange.createOrder(symbol, 'limit', 'sell', actualAmount, takeProfitPrice, {
                        'mgnMode': 'isolated',
                        'posSide': 'long',
                        'reduceOnly': true
                    });
                    logMsg += `\n止盈订单信息:${JSON.stringify(tpOrder)}`;
                }

                console.log(logMsg);
                // 推送lark
                await this.sendLarkMessage("OKX下单成功", logMsg);
            } else {
                console.log(`在OKX为 ${token} 使用逐仓模式下单失败，因为实际下单数量为0`);
            }
        } catch (error) {
            console.error(`在OKX下单时出错:`, error);
            // 推送lark
            await this.sendLarkMessage("OKX下单失败", `在OKX为 ${token} 使用逐仓模式下单失败，因为实际下单数量为0, 错误信息: ${error}`);
        }
    }

    static async placeLongOrderGateIO(token: string) {
        try {
            const exchange = config.gateio;
            const symbol = `${token}/USDT:USDT`;

            // 获取账户余额
            const balance = await exchange.fetchBalance({ 'type': 'swap' });
            const availableUSDT = balance.USDT?.free || 0;
            // const availableUSDT = 10;
            console.log(`Gate.io可用USDT余额: ${balance.USDT?.free}`);

            const amount = availableUSDT*0.9; // 设置合适的下单数量
            const leverage = 3; // 设置5倍杠杆, 其他倍数设置不成功，鬼知道为什么

             // 设置杠杆和逐仓模式
            // await exchange.setPositionMode(true);  // 设置为双向持仓模式
            await exchange.setLeverage(leverage, symbol, {
                'mgnMode': 'isolated',
                'posSide': 'long',
            });
            
            // 获取当前市场价格
            const ticker = await exchange.fetchTicker(symbol);
            const price = ticker.last;
            // 获取每张合约的价值
            const contractSize = exchange.market(symbol)?.contractSize ?? 1;
            const contractValue = price ? price * contractSize : 0;
            console.log(`每张合约的价值: ${contractValue} USDT`);

            // 计算实际下单数量（以保证金金额为基准）
            const rawAmount = contractValue > 0 ? amount / contractValue * leverage : 0;
            const actualAmount = Math.floor(rawAmount);

            console.log("实际下单数量:", actualAmount, amount, price, leverage);
            if (actualAmount > 0) {
                // 下市价单开仓
                const order = await exchange.createMarketOrder(symbol, 'buy', actualAmount, undefined, {
                    'tdMode': 'isolated',
                    'leverage': leverage,
                    'type': 'market', 
                    'contracts': actualAmount,
                    'timeInForce': 'IOC',
                    'reduceOnly': false,
                    'marginMode': 'isolated',
                    'posSide': 'long',
                    'postOnly': false
                });

                var logMsg = `在Gate.io为 ${token} 使用逐仓模式下了${leverage}倍多单，订单信息:${JSON.stringify(order)}`;
                if (price) {
                    // 下20%止盈限价单
                    const takeProfitPrice = price * 1.1; // 在当前价格基础上加20%
                    const takeProfitOrder = await exchange.createOrder(symbol, 'limit', 'sell', actualAmount, takeProfitPrice, {
                        'tdMode': 'isolated',
                        'leverage': leverage,
                        'reduceOnly': true,
                        'marginMode': 'isolated',
                        'posSide': 'long',
                        'postOnly': false
                    });
                    logMsg += `\n止盈订单信息:${JSON.stringify(takeProfitOrder)}`;
                }

                console.log(logMsg);
                await this.sendLarkMessage("Gate.io下单成功", logMsg);
            } else {
                console.log(`在Gate.io为 ${token} 使用逐仓模式下单失败，因为实际下单数量为0`);
            }
        } catch (error) {
            console.error(`在Gate.io下单时出错:`, error);
            await this.sendLarkMessage("Gate.io下单失败", `错误信息: ${error}`);
    }
    }
    // 推送lark
    static async sendLarkMessage(title: string, msg: string) {
        try {
            // 构建飞书消息内容
            const messageContent = {
                msg_type: "text",
                content: {
                    text: `# ${title}\n${msg}`
                }
            };

            console.log(`发送飞书消息: ${JSON.stringify(messageContent)}`);
            // 发送POST请求到飞书webhook
            const response = await fetch(config.lark, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(messageContent)
            });

            if (!response.ok) {
                throw new Error(`飞书消息发送失败: ${response.statusText}`);
            }

            console.log('飞书消息发送成功');
        } catch (error) {
            console.error('发送飞书消息时出错:', error);
        }
    }

}
