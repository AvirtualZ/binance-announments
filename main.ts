import Binance from "./binance_notifier";

async function main() {
    try {
        const tokens = await Binance.CheckAnnouncements();
        await Binance.CheckAndPlaceOrder(tokens);
    } catch (error) {
        console.error('发生错误:', error);
    } finally {
        // 在程序结束时关闭连接
        // await okx.close();
        // await gateio.close();
    }
}

async function run() {
    // 如果您使用定时器，请确保在每次循环结束时关闭连接
setInterval(async () => {
    try {
        const tokens = await Binance.CheckAnnouncements();
        await Binance.CheckAndPlaceOrder(tokens);
    } catch (error) {
        console.error('发生错误:', error);
    }
    }, 10000);
}

run();


