/**
 * ============================================================================
 * 修罗影视 - OmniBox 爬虫脚本
 * 站点地址: https://www.xlys02.com
 * ============================================================================
 * 核心功能:
 *   - 首页分类: 电影/电视剧/综艺/短剧
 *   - 分类筛选: 类型/地区/年份/排序
 *   - 详情解析: 自动提取剧集列表
 *   - 播放解析: 直连优先，TOS线路，屏蔽下载线路
 *   - 搜索功能: OCR验证码识别，会话缓存(20分钟)
 * 修改时间: 2026-02-27
 */

const CryptoJS = require("crypto-js");
const axios = require("axios");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");
const https = require("https");

// ========== 全局配置 ==========
const HOST = "https://www.xlys02.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";

// 会话缓存(20分钟)
let SESSION_CACHE = {
    cookie: null,
    expire: 0
};
const SESSION_TTL = 20 * 60 * 1000;

/**
 * 创建 HTTPS Agent (忽略 SSL 证书验证)
 */
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    scheduling: 'lifo',
    rejectUnauthorized: false  // 忽略 SSL 证书验证
});

/**
 * 创建 Axios 实例
 */
const axiosInstance = axios.create({
    httpsAgent
});

// ========== 日志工具 ==========
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[修罗影视] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[修罗影视] ${message}: ${error.message || error}`);
};

// ========== 工具函数 ==========
const fixImg = (img) => {
    if (!img) return "";
    if (img.startsWith("http")) return img;
    if (img.startsWith("//")) return "https:" + img;
    return HOST + img;
};

const getId = (href) => {
    if (!href) return "";
    let id = href.split(".htm")[0];
    if (id.startsWith("/")) id = id.substring(1);
    return id;
};

const request = async (url, options = {}) => {
    try {
        logInfo("🌐 请求", url);
        const res = await axiosInstance.get(url, {
            headers: {
                "User-Agent": UA,
                "Referer": HOST,
                ...options.headers
            },
            timeout: 15000,
            ...options
        });
        return res.data;
    } catch (e) {
        logError("❌ 请求失败", e);
        return "";
    }
};

const requestPost = async (url, data, options = {}) => {
    try {
        logInfo("🌐 POST请求", url);
        const res = await axiosInstance.post(url, data, {
            headers: {
                "User-Agent": UA,
                "Referer": HOST,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                ...options.headers
            },
            timeout: 15000,
            ...options
        });
        return res.data;
    } catch (e) {
        logError("❌ POST请求失败", e);
        return null;
    }
};

// ========== 筛选配置 ==========
const filters = {
    movie: [
        { key: "genre", name: "类型", init: "all", value: [{ name: "不限", value: "all" }, { name: "动作", value: "dongzuo" }, { name: "爱情", value: "aiqing" }, { name: "喜剧", value: "xiju" }, { name: "科幻", value: "kehuan" }, { name: "恐怖", value: "kongbu" }, { name: "战争", value: "zhanzheng" }, { name: "武侠", value: "wuxia" }, { name: "魔幻", value: "mohuan" }, { name: "剧情", value: "juqing" }, { name: "动画", value: "donghua" }, { name: "惊悚", value: "jingsong" }, { name: "3D", value: "3D" }, { name: "灾难", value: "zainan" }, { name: "悬疑", value: "xuanyi" }, { name: "警匪", value: "jingfei" }, { name: "文艺", value: "wenyi" }, { name: "青春", value: "qingchun" }, { name: "冒险", value: "maoxian" }, { name: "犯罪", value: "fanzui" }, { name: "记录", value: "jilu" }, { name: "古装", value: "guzhuang" }, { name: "奇幻", value: "奇幻" }] },
        { key: "area", name: "地区", init: "", value: [{ name: "不限", value: "" }, { name: "中国大陆", value: "中国大陆" }, { name: "中国香港", value: "中国香港" }, { name: "美国", value: "美国" }, { name: "日本", value: "日本" }, { name: "韩国", value: "韩国" }, { name: "法国", value: "法国" }, { name: "印度", value: "印度" }, { name: "德国", value: "德国" }] },
        { key: "year", name: "年份", init: "", value: [{ name: "不限", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }, { name: "2024", value: "2024" }, { name: "2023", value: "2023" }, { name: "2022", value: "2022" }] },
        { key: "order", name: "排序", init: "0", value: [{ name: "更新时间", value: "0" }, { name: "豆瓣评分", value: "1" }] }
    ],
    tv: [
        { key: "genre", name: "类型", init: "all", value: [{ name: "不限", value: "all" }, { name: "动作", value: "dongzuo" }, { name: "爱情", value: "aiqing" }, { name: "喜剧", value: "xiju" }, { name: "剧情", value: "juqing" }] },
        { key: "area", name: "地区", init: "", value: [{ name: "不限", value: "" }, { name: "中国大陆", value: "中国大陆" }, { name: "美国", value: "美国" }, { name: "韩国", value: "韩国" }] },
        { key: "year", name: "年份", init: "", value: [{ name: "不限", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }] },
        { key: "order", name: "排序", init: "0", value: [{ name: "更新时间", value: "0" }, { name: "豆瓣评分", value: "1" }] }
    ]
};

// ========== 验证码计算 ==========
const calcVerifyCode = (text) => {
    if (!text) return null;
    let exp = text.replace(/\s/g, "").replace("=", "");
    exp = exp.replace(/[xX×]/g, "*").replace(/-/g, "-");
    const match = exp.match(/^(\d+)([\+\-\*])(\d+)$/);
    if (!match) return null;
    const a = parseInt(match[1], 10);
    const op = match[2];
    const b = parseInt(match[3], 10);
    switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        default: return null;
    }
};

// ========== 核心接口实现 ==========

async function home(params) {
    logInfo("🏠 进入首页");
    return {
        class: [
            { type_id: "movie", type_name: "电影" },
            { type_id: "tv", type_name: "电视剧" },
            { type_id: "zongyi", type_name: "综艺" },
            { type_id: "duanju", type_name: "短剧" }
        ],
        filters: filters,
        list: []
    };
}

async function category(params) {
    logInfo(`📂 请求参数: ${params}`);

    const { categoryId, page, filters: filterParams } = params;
    const pg = parseInt(page) || 1;
    var genre = filterParams?.genre || categoryId;
    if (genre == 'movie' || genre == 'tv') {
        genre = 'all';
    }

    logInfo(`📂 请求分类: ${categoryId}, 页码: ${pg}`);

    let url = `${HOST}/s/${genre}/${pg}`;
    const urlParams = [];

    if (categoryId !== "zongyi" && categoryId !== "duanju") {
        urlParams.push(`type=${categoryId === "tv" ? "1" : "0"}`);
    }
    if (filterParams?.area) urlParams.push(`area=${encodeURIComponent(filterParams.area)}`);
    if (filterParams?.year) urlParams.push(`year=${filterParams.year}`);
    if (filterParams?.order) urlParams.push(`order=${filterParams.order}`);
    if (urlParams.length > 0) url += `?${urlParams.join("&")}`;

    try {
        const html = await request(url);

        // 如果返回空，记录并返回空列表
        if (!html) {
            logInfo("⚠ 返回HTML为空");
            return { list: [], page: pg, pagecount: pg };
        }

        const $ = cheerio.load(html);
        const list = [];

        $(".row-cards .card.card-link").each((_, el) => {
            const href = $(el).find("a").attr("href");
            if (href) {
                list.push({
                    vod_id: getId(href),
                    vod_name: $(el).find(".card-title").text().trim(),
                    vod_pic: fixImg($(el).find("img").attr("src")),
                    vod_remarks: $(el).find(".text-muted").text().trim()
                });
            }
        });

        logInfo(`✅ 解析到 ${list.length} 条数据`);

        return {
            list,
            page: pg,
            pagecount: list.length >= 24 ? pg + 1 : pg
        };
    } catch (e) {
        logError("分类解析异常", e);
        return { list: [], page: pg, pagecount: pg };
    }
}

async function detail(params) {
    const videoId = params.videoId;
    logInfo(`📄 请求详情 ID: ${videoId}`);

    const detailUrl = `${HOST}/${videoId}.htm`;
    const html = await request(detailUrl);
    if (!html) return { list: [] };

    const $ = cheerio.load(html);
    const playUrls = [];

    $("#play-list a").each((_, item) => {
        const name = $(item).text().trim();
        const href = $(item).attr("href");
        if (name && href) {
            const fullPlayId = getId(href);
            logInfo(`🔗 找到剧集: ${name} -> ID: ${fullPlayId}`);
            playUrls.push(`${name}$${fullPlayId}`);
        }
    });

    // 转换为 OmniBox 播放源格式
    const playSources = [{
        name: "修罗直连",
        episodes: playUrls.map(item => {
            const parts = item.split('$');
            return {
                name: parts[0] || '正片',
                playId: parts[1] || parts[0]
            };
        })
    }];

    return {
        list: [{
            vod_id: videoId,
            vod_name: $("h2").first().text().trim(),
            vod_pic: fixImg($("img.cover").attr("src")),
            vod_content: $("#synopsis").text().trim(),
            vod_play_sources: playSources
        }]
    };
}

async function search(params) {
    const keyword = (params.keyword || params.wd || "").trim();
    const pg = parseInt(params.page) || 1;

    if (!keyword) {
        logInfo("⚠ 搜索关键词为空");
        return { list: [] };
    }

    const now = Date.now();

    // 优先使用缓存
    if (SESSION_CACHE.cookie && now < SESSION_CACHE.expire) {
        logInfo("♻ 使用缓存会话");
        try {
            const fastUrl = `${HOST}/search/${encodeURIComponent(keyword)}/${pg}`;
            const fastRes = await axiosInstance.get(fastUrl, {
                headers: {
                    "User-Agent": MOBILE_UA,
                    "Cookie": SESSION_CACHE.cookie
                }
            });
            const result = await parseSearch(fastRes.data, pg, keyword);
            if (result.list.length > 0) {
                logInfo("✅ 缓存会话有效");
                return result;
            }
            logInfo("⚠ 缓存失效，重新验证");
        } catch (e) {
            logError("⚠ 缓存请求异常", e);
        }
    }

    logInfo(`🔍 开始搜索: ${keyword}`);
    const ocrApi = "https://api.nn.ci/ocr/b64/json";
    const MAX_FLOW_RETRY = 3;

    try {
        for (let flow = 1; flow <= MAX_FLOW_RETRY; flow++) {
            logInfo(`🔁 第 ${flow} 轮验证码流程`);

            // 初始化会话
            const searchUrl = `${HOST}/search/${encodeURIComponent(keyword)}/${pg}`;
            const initRes = await axiosInstance.get(searchUrl, {
                headers: { "User-Agent": MOBILE_UA }
            });
            const rawCookies = initRes.headers["set-cookie"] || [];
            const cookieStr = rawCookies.map(c => c.split(";")[0]).join("; ");
            const finalCookie = `gg_iscookie=1; ${cookieStr}`;
            logInfo("🍪 新会话Cookie");

            // 获取验证码 + OCR
            let verifyCode = null;
            for (let i = 1; i <= 3; i++) {
                try {
                    logInfo(`🖼 获取验证码 第${i}次`);
                    const imgRes = await axiosInstance.get(
                        `${HOST}/search/verifyCode?t=${Date.now()}`,
                        {
                            headers: {
                                "User-Agent": MOBILE_UA,
                                "Cookie": finalCookie,
                                "Referer": searchUrl
                            },
                            responseType: "arraybuffer"
                        }
                    );
                    const b64 = Buffer.from(imgRes.data).toString("base64");
                    const ocrRes = await axiosInstance.post(ocrApi, b64, {
                        headers: { "User-Agent": MOBILE_UA },
                        timeout: 8000
                    });
                    const raw = ocrRes.data?.result?.trim();
                    logInfo(`🧾 OCR识别: ${raw}`);
                    verifyCode = calcVerifyCode(raw);
                    if (verifyCode !== null) {
                        logInfo(`✅ 验证码计算结果: ${verifyCode}`);
                        break;
                    }
                } catch (e) {
                    logError("⚠ OCR异常", e);
                }
            }

            if (!verifyCode) {
                logInfo("❌ OCR失败，重新整轮流程");
                continue;
            }

            // 提交验证码
            const submitUrl = `${HOST}/search/${encodeURIComponent(keyword)}?code=${verifyCode}`;
            logInfo("📡 提交搜索");
            const htmlRes = await axiosInstance.get(submitUrl, {
                headers: {
                    "User-Agent": MOBILE_UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Cookie": finalCookie,
                    "Referer": submitUrl
                }
            });

            const html = htmlRes.data || "";
            if (html.includes("verifyCode") || html.includes("验证码")) {
                logInfo("⚠ 仍是验证码页，重试");
                continue;
            }

            const result = await parseSearch(html, pg, keyword);
            if (result.list.length > 0) {
                SESSION_CACHE.cookie = finalCookie;
                SESSION_CACHE.expire = Date.now() + SESSION_TTL;
                logInfo("💾 会话缓存成功(20分钟)");
                logInfo(`🎯 搜索成功: ${result.list.length}条`);
                return result;
            }
            logInfo("⚠ 无结果，重新整轮流程");
        }

        logInfo("❌ 所有流程失败");
        return { list: [] };
    } catch (e) {
        logError("❌ 搜索异常", e);
        return { list: [] };
    }
}

async function parseSearch(html, pg, keyword = "") {
    if (!html) {
        logInfo("❌ 解析HTML为空");
        return { list: [] };
    }

    const $ = cheerio.load(html);
    const list = [];
    keyword = (keyword || "").trim();

    $(".row-cards .col-12").each((_, el) => {
        const titleNode = $(el).find(".search-movie-title").first();
        if (!titleNode.length) return;
        const href = titleNode.attr("href");
        if (!href) return;
        const rawTitle = titleNode.text().replace(/\s+/g, " ").trim();
        const match = rawTitle.match(/《([^》]+)》/);
        if (!match) {
            logInfo(`⏭ 无书名号跳过: ${rawTitle}`);
            return;
        }
        const pureTitle = match[1];
        if (keyword && !pureTitle.includes(keyword)) {
            logInfo(`🚫 过滤: ${pureTitle}`);
            return;
        }
        const vod_id = getId(href);
        const vod_pic = fixImg($(el).find("a img").first().attr("src"));
        logInfo(`✅ 命中结果: ${pureTitle}`);
        list.push({
            vod_id,
            vod_name: pureTitle,
            vod_pic,
            vod_remarks: ""
        });
    });

    let pagecount = pg;
    const pages = $(".pagination li a")
        .map((_, a) => $(a).text().trim())
        .get()
        .filter(t => /^\d+$/.test(t));
    if (pages.length > 0) {
        pagecount = parseInt(pages[pages.length - 1]);
    }

    logInfo(`📄 分页识别: 当前=${pg} 最大=${pagecount}`);
    return { list, page: pg, pagecount };
}

async function play(params) {
    const playId = params.playId;
    logInfo(`🎬 准备解析: ${playId}`);

    try {
        const playPageUrl = `${HOST}/${playId}.htm`;
        const playPageHtml = await request(playPageUrl);
        const pidMatch = playPageHtml.match(/var pid = (\d+);/);

        if (!pidMatch) {
            logInfo("❌ 无法提取 pid，直接返回嗅探");
            return {
                urls: [{ name: "嗅探", url: playPageUrl }],
                parse: 1
            };
        }

        const pid = pidMatch[1];
        const t = new Date().getTime();
        const keyStr = CryptoJS.MD5(pid + '-' + t).toString().substring(0, 16);
        const key = CryptoJS.enc.Utf8.parse(keyStr);
        const encrypted = CryptoJS.AES.encrypt(pid + '-' + t, key, {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7
        });
        const sg = encrypted.ciphertext.toString(CryptoJS.enc.Hex).toUpperCase();
        const linesUrl = `${HOST}/lines?t=${t}&sg=${sg}&pid=${pid}`;

        logInfo("📡 请求线路接口");
        const res = await axiosInstance.get(linesUrl, {
            headers: {
                "User-Agent": UA,
                "Referer": playPageUrl,
                "X-Requested-With": "XMLHttpRequest"
            }
        });

        if (!res.data || res.data.code !== 0 || !res.data.data) {
            logInfo("❌ 接口返回异常");
            return {
                urls: [{ name: "嗅探", url: playPageUrl }],
                parse: 1
            };
        }

        const d = res.data.data;
        const playUrls = [];

        // 直连优先
        if (d.url3) {
            const urls = d.url3.split(',');
            for (let i = 0; i < urls.length; i++) {
                const u = urls[i].trim();
                if (!u || u.includes(".m3u8") || u.includes("p3-tt.byteimg.com")) {
                    logInfo(`🚫 屏蔽线路: ${u}`);
                    continue;
                }
                playUrls.push({ name: `直链${i + 1}`, url: u });
                logInfo(`✅ 直链${i + 1}: ${u}`);
            }
        }

        // TOS 线路
        if (d.tos) {
            try {
                const tosUrl = `${HOST}/god/${pid}?type=1`;
                const tosRes = await requestPost(tosUrl, `t=${t}&sg=${sg}&verifyCode=888`);
                if (tosRes && tosRes.url && !tosRes.url.includes(".m3u8") && !tosRes.url.includes("byteimg")) {
                    playUrls.push({ name: "TOS", url: tosRes.url });
                    logInfo(`✅ TOS线路: ${tosRes.url}`);
                }
            } catch (e) {
                logError("❌ TOS处理失败", e);
            }
        }

        if (playUrls.length > 0) {
            logInfo(`🎉 最终可播放线路数量: ${playUrls.length}`);
            return {
                urls: playUrls,
                parse: 0,
                header: {
                    "User-Agent": UA,
                    "Referer": HOST
                }
            };
        } else {
            logInfo("⚠ 无可用线路，返回嗅探");
            return {
                urls: [{ name: "嗅探", url: playPageUrl }],
                parse: 1
            };
        }
    } catch (e) {
        logError("🔥 播放异常", e);
        return {
            urls: [{ name: "嗅探", url: `${HOST}/play/${playId}.htm` }],
            parse: 1
        };
    }
}

// ========== 导出模块 ==========
module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);