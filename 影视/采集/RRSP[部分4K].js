/**
 * ============================================================================
 * RRSP资源 - OmniBox 爬虫脚本 (增强日志调试版)
 * ============================================================================
 */
const axios = require("axios");
const https = require("https");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 [1] ==========
const host = 'https://rrsp-api.kejiqianxian.com:60425';
const def_headers = {
    'User-Agent': 'rrsp.wang',
    'origin': '*',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json'
};

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 15000
});

/**
 * 日志工具函数 [2]
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[RRSP-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[RRSP-DEBUG] ${message}: ${error.message || error}`);
};

/**
 * 图像地址修复 [1]
 */
const fixPicUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return url.startsWith('/') ? `${host}${url}` : `${host}/${url}`;
};

/**
 * 核心：解析 CMS 字符串为结构化播放源 [1][2]
 * 逻辑：将 "来源1$$$来源2" 和 "第1集$ID1#第2集$ID2" 转换为 UI 识别的数组
 */
const parsePlaySources = (fromStr, urlStr) => {
    logInfo("开始解析播放源字符串", { from: fromStr, url: urlStr });
    const playSources = [];
    if (!fromStr || !urlStr) return playSources;

    const froms = fromStr.split('$$$');
    const urls = urlStr.split('$$$');

    for (let i = 0; i < froms.length; i++) {
        const sourceName = froms[i] || `线路${i + 1}`;
        const sourceItems = urls[i] ? urls[i].split('#') : [];
        
        const episodes = sourceItems.map(item => {
            const parts = item.split('$');
            return {
                name: parts[0] || '正片',
                playId: parts[1] || parts[0]
            };
        }).filter(e => e.playId);

        if (episodes.length > 0) {
            playSources.push({
                name: sourceName,
                episodes: episodes
            });
        }
    }
    logInfo("播放源解析结果", playSources);
    return playSources;
};

const arr2vods = (arr) => {
    return (arr || []).map(i => ({
        vod_id: String(i.vod_id),
        vod_name: i.vod_name,
        vod_pic: fixPicUrl(i.vod_pic),
        vod_remarks: i.vod_serial === '1' ? `${i.vod_serial}集` : `评分:${i.vod_score || '0'}`
    }));
};

// ========== 接口实现 ==========

async function home(params) {
    logInfo("进入首页");
    return {
        class: [
            { 'type_id': '1', 'type_name': '电影' },
            { 'type_id': '2', 'type_name': '电视剧' },
            { 'type_id': '3', 'type_name': '综艺' },
            { 'type_id': '5', 'type_name': '动漫' },
            { 'type_id': '4', 'type_name': '纪录片' },
            { 'type_id': '6', 'type_name': '短剧' }
        ],
        list: [] 
    };
}

async function category(params) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);
    try {
        const res = await axiosInstance.post(`${host}/api.php/main_program/moviesAll/`, {
            type: categoryId || '',
            sort: 'vod_time',
            page: pg,
            limit: '60'
        }, { headers: def_headers });

        logInfo("分类接口返回原始数据", res.data);
        
        return {
            list: arr2vods(res.data.data.list),
            page: res.data.data.page || pg,
            pagecount: res.data.data.pagecount || 100
        };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);
    try {
        const res = await axiosInstance.post(`${host}/api.php/player/details/`, { id: videoId }, { headers: def_headers });
        const data = res.data.detailData;
        
        logInfo("详情接口返回原始数据", data);

        // 修复：补全图片并解析播放源 [1][2]
        const playSources = parsePlaySources(data.vod_play_from, data.vod_play_url);

        return {
            list: [{
                vod_id: String(data.vod_id),
                vod_name: data.vod_name,
                vod_pic: fixPicUrl(data.vod_pic),
                vod_content: data.vod_content,
                vod_play_sources: playSources, // 关键：荐片架构必须返回此数组
                vod_year: data.vod_year,
                vod_area: data.vod_area,
                vod_actor: data.vod_actor,
                type_name: data.vod_class
            }]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);
    try {
        const res = await axiosInstance.post(`${host}/api.php/search/syntheticalSearch/`, {
            keyword: wd,
            page: pg,
            limit: '20'
        }, { headers: def_headers });
        
        const data = res.data.data;
        const videos = [...arr2vods(data.chasingFanCorrelation), ...arr2vods(data.moviesCorrelation)];

        return {
            list: videos,
            page: pg,
            pagecount: data.pagecount || 10
        };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function play(params) {
    const playId = params.playId;
    logInfo(`准备播放 ID: ${playId}`);
    let url = '';

    try {
        const res = await axiosInstance.post(`${host}/api.php/player/payVideoUrl/`, { url: playId }, { headers: def_headers });
        logInfo("解析接口返回", res.data);
        url = res.data.data.url;
    } catch (e) {
        logError("解析播放地址失败", e);
    }

    const finalUrl = (url && url.startsWith('http')) ? url : playId;
    logInfo(`最终播放地址: ${finalUrl}`);

    return {
        urls: [{ name: "极速云", url: finalUrl }],
        parse: 0,
        header: { ...def_headers, 'referer': 'https://docs.qq.com/' }
    };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);