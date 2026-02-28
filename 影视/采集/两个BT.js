/**
* ============================================================================
* 两个BT资源 - OmniBox 爬虫脚本
* ============================================================================
*/
const axios = require("axios");
const http = require("http");
const https = require("https");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const host = 'https://www.bttwoo.com';
const def_headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Referer': 'https://www.bttwoo.com/'
};

const axiosInstance = axios.create({
    timeout: 15000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true })
});

const PAGE_LIMIT = 20;

/**
* 日志工具函数
*/
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[两个BT-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[两个BT-DEBUG] ${message}: ${error.message || error}`);
};

/**
* 图像地址修复
*/
const fixPicUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    return url.startsWith('/') ? `${host}${url}` : `${host}/${url}`;
};

/**
* 检查搜索结果相关性
*/
const isRelevantSearchResult = (title, searchKey) => {
    if (!title || !searchKey) return false;
    
    const titleLower = title.toLowerCase();
    const searchKeyLower = searchKey.toLowerCase();
    
    if (titleLower.includes(searchKeyLower)) {
        return true;
    }
    
    const searchChars = new Set(searchKeyLower.replace(/\s+/g, ''));
    const titleChars = new Set(titleLower.replace(/\s+/g, ''));
    
    if (searchChars.size > 0) {
        const intersection = new Set([...searchChars].filter(x => titleChars.has(x)));
        const matchRatio = intersection.size / searchChars.size;
        if (matchRatio >= 0.6) {
            return true;
        }
    }
    
    if (searchKeyLower.length <= 2) {
        return titleLower.includes(searchKeyLower);
    }
    
    return false;
};

/**
* 从HTML提取视频列表
*/
const extractVideoList = ($, keyword = null) => {
    const list = [];
    const seenIds = new Set();
    
    const selectors = [
        'li:has(a[href*="/movie/"])',
        '.item li:has(a[href*="/movie/"])',
        'li .post'
    ];
    
    let foundElements = $();
    for (const selector of selectors) {
        const elements = $(selector);
        if (elements.length > 0) {
            foundElements = elements;
            break;
        }
    }
    
    foundElements.each((i, elem) => {
        const $elem = $(elem);
        
        const link = $elem.find('a[href*="/movie/"]').attr('href');
        if (!link) return;
        
        const vodIdMatch = link.match(/\/movie\/(\d+)\.html/);
        if (!vodIdMatch) return;
        
        const vodId = vodIdMatch[1];
        if (seenIds.has(vodId)) return;
        
        let title = '';
        const titleSelectors = ['h3 a', 'h3', 'a[title]', '.title', '.name'];
        
        for (const selector of titleSelectors) {
            const titleElem = $elem.find(selector);
            if (titleElem.length > 0) {
                title = titleElem.text().trim();
                if (title && title.length > 1) break;
            }
        }
        
        if (!title) return;
        
        // 搜索时检查相关性
        if (keyword && !isRelevantSearchResult(title, keyword)) {
            return;
        }
        
        seenIds.add(vodId);
        
        let pic = '';
        const picSelectors = ['img[data-original]', 'img[data-src]', 'img[src]'];
        
        for (const selector of picSelectors) {
            const img = $elem.find(selector);
            if (img.length > 0) {
                pic = img.attr('data-original') || img.attr('data-src') || img.attr('src');
                if (pic && !pic.endsWith('blank.gif') && !pic.includes('base64')) {
                    break;
                }
            }
        }
        
        let remarks = '';
        const remarkSelectors = ['.rating', '.status', 'span:contains("集")', 'span:contains("1080p")', 'span:contains("HD")'];
        
        for (const selector of remarkSelectors) {
            const remarkElem = $elem.find(selector);
            if (remarkElem.length > 0) {
                remarks = remarkElem.text().trim();
                if (remarks) break;
            }
        }
        
        list.push({
            vod_id: vodId,
            vod_name: title,
            vod_pic: fixPicUrl(pic),
            vod_remarks: remarks || ''
        });
    });
    
    return list;
};

/**
* 解析播放源为 OmniBox 格式
*/
const parsePlaySources = ($, vodId) => {
    try {
        logInfo("开始解析播放源");
        const playSources = [];
        
        const episodeElements = $('a[href*="/v_play/"]');
        const episodes = [];
        
        episodeElements.each((i, elem) => {
            const $elem = $(elem);
            const epTitle = $elem.text().trim();
            const epUrl = $elem.attr('href');
            
            if (epTitle && epUrl) {
                const playIdMatch = epUrl.match(/\/v_play\/([^.]+)\.html/);
                if (playIdMatch) {
                    episodes.push({
                        name: epTitle,
                        playId: playIdMatch[1]
                    });
                }
            }
        });
        
        if (episodes.length > 0) {
            playSources.push({
                name: '默认播放',
                episodes: episodes
            });
        } else {
            playSources.push({
                name: '默认播放',
                episodes: [{ name: '第1集', playId: 'bXZfMTM0NTY4LW5tXzE=' }]
            });
        }
        
        logInfo("播放源解析结果", playSources);
        return playSources;
    } catch (e) {
        logError("解析播放源失败", e);
        return [{ name: '默认播放', episodes: [{ name: '第1集', playId: 'bXZfMTM0NTY4LW5tXzE=' }] }];
    }
};

/**
* 构建URL
*/
const buildUrl = (tid, pg, extend = {}) => {
    try {
        let url = host;
        
        if (tid.startsWith('movie_bt_tags/')) {
            url += '/' + tid;
        } else if (tid === 'meiju') {
            url += '/meiju';
        } else if (tid === 'gf') {
            url += '/gf';
        } else {
            url += '/' + tid;
        }
        
        if (pg && pg !== '1') {
            url += url.includes('?') ? `&paged=${pg}` : `?paged=${pg}`;
        }
        
        if (extend.area) {
            url += url.includes('?') ? `&area=${encodeURIComponent(extend.area)}` : `?area=${encodeURIComponent(extend.area)}`;
        }
        
        if (extend.year) {
            url += url.includes('?') ? `&year=${encodeURIComponent(extend.year)}` : `?year=${encodeURIComponent(extend.year)}`;
        }
        
        return url;
    } catch (error) {
        logError("构建URL错误", error);
        return host + '/movie_bt_tags/xiju';
    }
};

// ========== 接口实现 ==========

async function home(params) {
    logInfo("进入首页");
    return {
        class: [
            { 'type_id': 'movie_bt_tags/xiju', 'type_name': '喜剧' },
            { 'type_id': 'movie_bt_tags/aiqing', 'type_name': '爱情' },
            { 'type_id': 'movie_bt_tags/adt', 'type_name': '冒险' },
            { 'type_id': 'movie_bt_tags/at', 'type_name': '动作' },
            { 'type_id': 'movie_bt_tags/donghua', 'type_name': '动画' },
            { 'type_id': 'movie_bt_tags/qihuan', 'type_name': '奇幻' },
            { 'type_id': 'movie_bt_tags/xuanni', 'type_name': '悬疑' },
            { 'type_id': 'movie_bt_tags/kehuan', 'type_name': '科幻' },
            { 'type_id': 'movie_bt_tags/juqing', 'type_name': '剧情' },
            { 'type_id': 'movie_bt_tags/kongbu', 'type_name': '恐怖' },
            { 'type_id': 'meiju', 'type_name': '美剧' },
            { 'type_id': 'gf', 'type_name': '高分电影' }
        ],
        list: []
    };
}

async function category(params) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);
    
    try {
        const url = buildUrl(categoryId, pg);
        logInfo(`分类URL: ${url}`);
        
        const res = await axiosInstance.get(url, { headers: def_headers });
        const $ = cheerio.load(res.data);
        
        const list = extractVideoList($);
        
        logInfo(`分类 ${categoryId} 第 ${pg} 页获取到 ${list.length} 个项目`);
        
        return {
            list: list,
            page: pg,
            pagecount: list.length >= PAGE_LIMIT ? pg + 1 : pg
        };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);
    
    try {
        let searchUrl = `${host}/xssssearch?q=${encodeURIComponent(wd)}`;
        if (pg && pg !== 1) {
            searchUrl += `&p=${pg}`;
        }
        
        logInfo(`搜索URL: ${searchUrl}`);
        
        const res = await axiosInstance.get(searchUrl, { headers: def_headers });
        const $ = cheerio.load(res.data);
        
        const list = extractVideoList($, wd);
        
        logInfo(`搜索 "${wd}" 找到 ${list.length} 个结果`);
        
        return {
            list: list,
            page: pg,
            pagecount: list.length >= PAGE_LIMIT ? pg + 1 : pg
        };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);
    
    try {
        let detailUrl = videoId;
        if (!detailUrl.includes('://') && !detailUrl.startsWith('/movie/')) {
            detailUrl = `/movie/${videoId}.html`;
        }
        
        if (detailUrl.startsWith('/')) {
            detailUrl = host + detailUrl;
        } else if (!detailUrl.includes('://')) {
            detailUrl = host + '/movie/' + videoId + '.html';
        }
        
        logInfo(`详情URL: ${detailUrl}`);
        
        const res = await axiosInstance.get(detailUrl, { headers: def_headers });
        const $ = cheerio.load(res.data);
        
        let title = '';
        const titleSelectors = ['h1', 'h2', 'title'];
        for (const selector of titleSelectors) {
            const titleElem = $(selector);
            if (titleElem.length > 0) {
                title = titleElem.text().trim();
                if (title) break;
            }
        }
        
        let pic = '';
        const picSelectors = ['img.poster', '.poster img', 'img[src]'];
        for (const selector of picSelectors) {
            const img = $(selector);
            if (img.length > 0) {
                pic = img.attr('src');
                if (pic && !pic.endsWith('blank.gif')) {
                    break;
                }
            }
        }
        
        let desc = '';
        const descSelectors = ['.intro', '.description', '.desc'];
        for (const selector of descSelectors) {
            const descElem = $(selector);
            if (descElem.length > 0) {
                desc = descElem.text().trim();
                if (desc) break;
            }
        }
        
        let actor = '';
        const actorSelectors = ['li:contains("主演")', 'span:contains("主演") + span'];
        for (const selector of actorSelectors) {
            const actorElem = $(selector);
            if (actorElem.length > 0) {
                actor = actorElem.text().trim().replace(/主演[:：]?/g, '').trim();
                if (actor) break;
            }
        }
        
        let director = '';
        const directorSelectors = ['li:contains("导演")', 'span:contains("导演") + span'];
        for (const selector of directorSelectors) {
            const directorElem = $(selector);
            if (directorElem.length > 0) {
                director = directorElem.text().trim().replace(/导演[:：]?/g, '').trim();
                if (director) break;
            }
        }
        
        const playSources = parsePlaySources($, videoId);
        
        logInfo("详情接口返回数据");
        
        return {
            list: [{
                vod_id: String(videoId),
                vod_name: title || '未知标题',
                vod_pic: fixPicUrl(pic),
                vod_content: desc || '',
                vod_play_sources: playSources,
                vod_year: '',
                vod_area: '',
                vod_actor: actor || '',
                vod_director: director || '',
                type_name: ''
            }]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

async function play(params) {
    const playId = params.playId;
    logInfo(`准备播放 ID: ${playId}`);
    
    try {
        let playUrl = playId;
        
        // 如果是Base64编码的播放ID，构建播放页URL
        if (playUrl && !playUrl.includes('://') && playUrl.length > 10) {
            const decodedId = Buffer.from(playId, 'base64').toString('utf-8');
            logInfo(`解码播放ID: ${decodedId}`);
            playUrl = `${host}/v_play/${playId}.html`;
        }
        
        // 确保URL格式正确
        if (playUrl && !playUrl.startsWith('http')) {
            playUrl = playUrl.startsWith('/') ? host + playUrl : host + '/' + playUrl;
        }
        
        logInfo(`处理后的播放URL: ${playUrl}`);
        
        // 检查是否是直接播放链接
        const isDirectPlayable = playUrl.match(/\.(m3u8|mp4|flv|avi|mkv|ts)/i);
        
        if (isDirectPlayable) {
            logInfo(`直接播放地址`);
            return {
                urls: [{ name: "默认线路", url: playUrl }],
                parse: 0,
                header: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': host + '/',
                    'Origin': host
                }
            };
        } else {
            logInfo(`需要解析的播放页`);
            // 返回播放页URL，让播放器解析
            return {
                urls: [{ name: "默认线路", url: playUrl }],
                parse: 1,
                header: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': host + '/',
                    'Origin': host
                }
            };
        }
    } catch (e) {
        logError("解析播放地址失败", e);
        // 错误时也构建完整URL
        const fallbackUrl = `${host}/v_play/${playId}.html`;
        return {
            urls: [{ name: "默认线路", url: fallbackUrl }],
            parse: 1,
            header: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': host + '/',
                'Origin': host
            }
        };
    }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);