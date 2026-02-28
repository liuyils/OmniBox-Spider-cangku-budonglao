/**
* ============================================================================
* 4KVM资源 - OmniBox 爬虫脚本
* ============================================================================
*/
const axios = require("axios");
const https = require("https");
const http = require("http");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const config = {
    host: "https://www.4kvm.org",
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.4kvm.org/",
        "Cache-Control": "no-cache"
    }
};

const axiosInstance = axios.create({
    timeout: 60 * 1000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true })
});

/**
* 日志工具函数
*/
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[4KVM-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[4KVM-DEBUG] ${message}: ${error.message || error}`);
};

/**
* 标准化URL
*/
const normalizeUrl = (url) => {
    if (!url) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${config.host}${url}`;
    return url;
};

/**
* 提取视频基本信息
*/
const extractVideoBasic = ($item) => {
    try {
        const link = normalizeUrl(
            $item.find('a').attr('href') ||
            $item.find('h3 a').attr('href') ||
            $item.find('.data h3 a').attr('href')
        );

        if (!link) return null;

        const title = (
            $item.find('h3').text().trim() ||
            $item.find('.data h3').text().trim() ||
            $item.find('img').attr('alt') ||
            $item.find('a').attr('title') ||
            '未知标题'
        );

        const img = normalizeUrl(
            $item.find('img').attr('src') ||
            $item.find('img').attr('data-src')
        );

        const remarks = (
            $item.find('.rating, .imdb, .vote').text().trim() ||
            $item.find('.year, .date, span').text().trim() ||
            $item.find('.type, .genre, .tag').text().trim() ||
            ''
        );

        return {
            vod_id: link,
            vod_name: title,
            vod_pic: img || '',
            vod_remarks: remarks
        };
    } catch (error) {
        logError("提取视频信息失败", error);
        return null;
    }
};

/**
* 获取视频列表
*/
const getVideoList = ($, selector = 'article, .items article, .content article') => {
    const videos = [];
    $(selector).each((_, element) => {
        const videoInfo = extractVideoBasic($(element));
        if (videoInfo) {
            videos.push(videoInfo);
        }
    });
    return videos;
};

/**
* 智能检测集数
*/
const getEpisodeCount = ($seasonData, pageHtml) => {
    try {
        // 方法1: 精确容器检测
        const episodeContainer = $seasonData('.jujiepisodios');
        if (episodeContainer.length) {
            const episodeLinks = episodeContainer.find('a');
            const episodeNumbers = [];
            episodeLinks.each((_, el) => {
                const text = $seasonData(el).text().trim();
                if (text && /^\d+$/.test(text)) {
                    const num = parseInt(text);
                    if (num >= 1 && num <= 500) {
                        episodeNumbers.push(num);
                    }
                }
            });
            if (episodeNumbers.length > 0) {
                return Math.max(...episodeNumbers);
            }
        }

        // 方法2: JavaScript数据提取
        const videoMatches = pageHtml.match(/video.*?=.*?\[(.*?)\]/gi);
        if (videoMatches) {
            for (const match of videoMatches) {
                const episodeNames = match.match(/"name"\s*:\s*(\d+)/g);
                if (episodeNames && episodeNames.length >= 5) {
                    const numbers = episodeNames.map(m => parseInt(m.match(/\d+/)[0]));
                    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
                    if (sorted[0] === 1 && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1) {
                        return Math.max(...sorted);
                    }
                }
            }
        }

        // 方法3: 文本模式匹配
        const pageText = $seasonData.text();
        const patterns = [/共(\d+)集/, /全(\d+)集/, /更新至(\d+)集/, /第(\d+)集/];
        for (const pattern of patterns) {
            const matches = pageText.match(pattern);
            if (matches && matches[1]) {
                return parseInt(matches[1]);
            }
        }

        // 默认值
        return $seasonData('iframe, video, .player').length ? 24 : 1;
    } catch (error) {
        logError("检测集数失败", error);
        return 1;
    }
};

/**
* 获取季度集数信息
*/
const getSeasonEpisodes = async ($, detailUrl) => {
    const playLinks = [];

    try {
        const seasonLinks = $('.seasons-list a, .season-item a, .se-c a, .se-a a, .seasons a');

        for (let i = 0; i < seasonLinks.length; i++) {
            const $season = seasonLinks.eq(i);
            const seasonTitle = $season.text().trim() || '第1季';
            const seasonUrl = normalizeUrl($season.attr('href'));

            if (!seasonUrl) continue;

            try {
                logInfo(`获取季度信息: ${seasonTitle}`);
                const seasonResp = await axiosInstance.get(seasonUrl, { headers: config.headers });
                const $seasonData = cheerio.load(seasonResp.data);

                const episodeCount = getEpisodeCount($seasonData, seasonResp.data);
                const limitedCount = Math.min(Math.max(episodeCount, 1), 500);

                logInfo(`${seasonTitle} 集数: ${limitedCount}`);

                if (limitedCount === 1) {
                    playLinks.push(`${seasonTitle}$${seasonUrl}`);
                } else {
                    const cleanTitle = seasonTitle.split('已完結')[0].split('更新')[0].trim();
                    for (let epNum = 1; epNum <= limitedCount; epNum++) {
                        const episodeTitle = `${cleanTitle} 第${epNum}集`;
                        const episodeUrl = `${seasonUrl}?ep=${epNum}`;
                        playLinks.push(`${episodeTitle}$${episodeUrl}`);
                    }
                }
            } catch (error) {
                logError("获取季度失败", error);
                playLinks.push(`${seasonTitle}$${seasonUrl}`);
            }
        }
    } catch (error) {
        logError("获取季度列表失败", error);
    }

    return playLinks;
};

/**
* 提取播放选项
*/
const extractPlayOptions = ($, detailUrl) => {
    const playLinks = [];
    const playOptions = $('#playeroptions ul li, .dooplay_player_option');

    playOptions.each((_, element) => {
        const $option = $(element);
        let title = $option.find('.title, span.title').text().trim() || '播放';
        const server = $option.find('.server, span.server').text().trim();

        if (server) {
            title = `${title}-${server}`;
        }

        const dataPost = $option.attr('data-post');
        const dataNume = $option.attr('data-nume');
        const dataType = $option.attr('data-type');

        if (dataPost && dataNume) {
            const playUrl = `${detailUrl}?post=${dataPost}&nume=${dataNume}&type=${dataType || 'movie'}`;
            playLinks.push(`${title}$${playUrl}`);
        }
    });

    return playLinks;
};

/**
* 将播放链接数组转换为 vod_play_sources 格式
*/
const parsePlaySources = (playLinks) => {
    if (!playLinks || playLinks.length === 0) {
        return [];
    }

    const episodes = playLinks.map(link => {
        const parts = link.split('$');
        return {
            name: parts[0] || '正片',
            playId: parts[1] || parts[0]
        };
    }).filter(e => e.playId);

    return [{
        name: '4KVM',
        episodes: episodes
    }];
};

/**
* 过滤电视剧内容
*/
const filterTVShowsOnly = (videoList) => {
    const movieKeywords = ['/movies/', '/movie/'];
    const tvshowKeywords = ['/tvshows/', '/tvshow/', '/seasons/'];

    return videoList.filter(video => {
        const vodId = video.vod_id || '';
        const isMovie = movieKeywords.some(keyword => vodId.includes(keyword));
        if (isMovie) return false;

        const isTvshow = tvshowKeywords.some(keyword => vodId.includes(keyword));
        return isTvshow || !isMovie;
    });
};

/**
* 过滤搜索结果
*/
const filterSearchResults = (results, searchKey) => {
    if (!results || !searchKey) return results;

    const searchKeyLower = searchKey.toLowerCase().trim();
    const searchWords = searchKeyLower.split(/\s+/);
    const scoredResults = [];

    for (const result of results) {
        const title = (result.vod_name || '').toLowerCase();
        let score = 0;

        // 计算相关性分数
        if (searchKeyLower === title) {
            score = 100;
        } else if (title.includes(searchKeyLower)) {
            score = 80;
        } else if (title.startsWith(searchKeyLower)) {
            score = 70;
        } else if (searchWords.every(word => title.includes(word))) {
            score = 60;
        } else {
            const wordMatches = searchWords.filter(word => title.includes(word)).length;
            if (wordMatches > 0) {
                score = 30 + (wordMatches * 10);
            } else {
                continue;
            }
        }

        // 内容类型加分
        if (searchKeyLower.includes('剧') && result.vod_id.includes('tvshows')) {
            score += 5;
        } else if (searchKeyLower.includes('电影') && result.vod_id.includes('movies')) {
            score += 5;
        }

        scoredResults.push({ score, result });
    }

    // 排序
    scoredResults.sort((a, b) => b.score - a.score);

    // 过滤低分结果
    const minScore = searchWords.length > 1 ? 30 : 40;
    let filtered = scoredResults.filter(item => item.score >= minScore).map(item => item.result);

    // 如果结果太少,放宽标准
    if (filtered.length < 3 && scoredResults.length > 3) {
        filtered = scoredResults.slice(0, 10).map(item => item.result);
    }

    return filtered;
};

// ========== 接口实现 ==========

/**
* 首页
*/
async function home(params) {
    logInfo("进入首页");
    
    try {
        const response = await axiosInstance.get(config.host, { headers: config.headers });
        const $ = cheerio.load(response.data);
        
        // 提取分类
        const classes = [];
        $('header .head-main-nav ul.main-header > li').each((_, element) => {
            const $el = $(element);
            const mainLink = $el.children('a').eq(0);
            const link = mainLink.attr('href');
            const name = mainLink.text().trim();

            if (link && name && !['首页', '影片下载'].includes(name)) {
                const normalizedLink = normalizeUrl(link);
                classes.push({
                    type_id: normalizedLink,
                    type_name: name
                });
                
                // 提取子分类
                $el.find('ul li').each((_, subElement) => {
                    const $sub = $(subElement);
                    const subLink = normalizeUrl($sub.find('a').attr('href'));
                    const subName = $sub.find('a').text().trim();

                    if (subLink && subName) {
                        classes.push({
                            type_id: subLink,
                            type_name: `${name}-${subName}`
                        });
                    }
                });
            }
        });
        
        // 获取首页推荐列表
        const homeList = getVideoList($, 'article, .module .content .items .item, .movies-list article');
        
        logInfo(`分类获取完成,共 ${classes.length} 个`);
        
        return {
            class: classes,
            list: homeList
        };
    } catch (error) {
        logError("首页获取失败", error);
        return {
            class: [
                { 'type_id': `${config.host}/movies/`, 'type_name': '电影' },
                { 'type_id': `${config.host}/tvshows/`, 'type_name': '电视剧' },
                { 'type_id': `${config.host}/genre/dongzuo/`, 'type_name': '动作' },
                { 'type_id': `${config.host}/genre/xiju/`, 'type_name': '喜剧' }
            ],
            list: []
        };
    }
}

/**
* 分类
*/
async function category(params) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);

    try {
        let url = categoryId;
        if (pg > 1) {
            url = categoryId.includes('?')
                ? `${categoryId}&page=${pg}`
                : `${categoryId}/page/${pg}`;
        }

        const response = await axiosInstance.get(url, { headers: config.headers });
        const $ = cheerio.load(response.data);

        let videoList = getVideoList($);

        // 如果是电视剧分类,过滤电影
        if (categoryId.includes('电视剧') || categoryId.includes('tvshows')) {
            videoList = filterTVShowsOnly(videoList);
        }

        logInfo(`获取到 ${videoList.length} 个视频`);

        return {
            list: videoList,
            page: pg,
            pagecount: 9999
        };
    } catch (error) {
        logError("分类请求失败", error);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
* 详情
*/
async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);

    try {
        const response = await axiosInstance.get(videoId, { headers: config.headers });
        const $ = cheerio.load(response.data);

        const vod = {
            vod_id: videoId,
            vod_name: $('.sheader h1, h1').first().text().trim() || '未知标题',
            vod_pic: normalizeUrl($('.sheader .poster img, .poster img').first().attr('src')),
            vod_content: $('.sbox .wp-content, #info .wp-content').first().text().trim(),
            vod_year: '',
            vod_area: '',
            vod_remarks: '',
            vod_actor: '',
            vod_director: ''
        };

        // 提取分类
        const genres = [];
        $('.sgeneros a').each((_, el) => {
            genres.push($(el).text().trim());
        });
        if (genres.length > 0) {
            vod.type_name = genres.join(', ');
        }

        logInfo(`视频标题: ${vod.vod_name}`);

        // 获取播放链接
        let playLinks = extractPlayOptions($, videoId);

        // 如果没有播放选项,尝试获取季度信息
        if (playLinks.length === 0) {
            const seasonLinks = $('.seasons-list a, .season-item a, .se-c a, .se-a a, .seasons a');
            if (seasonLinks.length > 0) {
                playLinks = await getSeasonEpisodes($, videoId);
            } else {
                playLinks = [`播放$${videoId}`];
            }
        }

        // 转换为 vod_play_sources 格式
        vod.vod_play_sources = parsePlaySources(playLinks);

        logInfo(`播放链接数: ${playLinks.length}`);

        return {
            list: [vod]
        };
    } catch (error) {
        logError("详情获取失败", error);
        return { list: [] };
    }
}

/**
* 搜索
*/
async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);

    try {
        let searchUrl = `${config.host}/xssearch?s=${encodeURIComponent(wd)}`;
        if (pg > 1) {
            searchUrl += `&p=${pg}`;
        }

        const response = await axiosInstance.get(searchUrl, { headers: config.headers });
        const $ = cheerio.load(response.data);

        const rawResults = getVideoList($, 'article, .items article, .content article, .search-results article');
        const filteredResults = filterSearchResults(rawResults, wd);

        logInfo(`搜索到 ${filteredResults.length} 个结果`);

        return {
            list: filteredResults,
            page: pg,
            pagecount: 9999
        };
    } catch (error) {
        logError("搜索失败", error);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
* 播放
*/
async function play(params) {
    const playId = params.playId;
    logInfo(`准备播放 ID: ${playId}`);

    try {
        // 解析参数
        let dataPost = null;
        let dataNume = null;
        let dataType = null;
        let baseUrl = playId;

        if (playId.includes('?')) {
            const [url, queryParams] = playId.split('?', 2);
            baseUrl = url;
            const paramPairs = queryParams.split('&');
            for (const pair of paramPairs) {
                const [key, value] = pair.split('=');
                if (key === 'post') dataPost = value;
                if (key === 'nume') dataNume = value;
                if (key === 'type') dataType = value;
            }
        }

        // API调用
        if (dataPost && dataNume) {
            try {
                const apiUrl = `${config.host}/wp-json/dooplayer/v1/post/${dataPost}`;
                const apiResponse = await axiosInstance.get(apiUrl, {
                    headers: config.headers,
                    params: {
                        type: dataType || 'movie',
                        source: dataNume
                    }
                });

                if (apiResponse.status === 200 && apiResponse.data.embed_url) {
                    const embedUrl = apiResponse.data.embed_url;
                    const parseFlag = ['.m3u8', '.mp4', '.flv', '.avi'].some(ext =>
                        embedUrl.toLowerCase().includes(ext)
                    ) ? 0 : 1;

                    logInfo(`API解析成功: ${embedUrl}`);
                    return {
                        urls: [{ name: "4KVM", url: embedUrl }],
                        parse: parseFlag,
                        header: config.headers
                    };
                }
            } catch (error) {
                logError("API调用失败", error);
            }
        }

        // 页面解析回退
        const response = await axiosInstance.get(baseUrl, { headers: config.headers });
        const $ = cheerio.load(response.data);

        // 查找iframe
        const iframe = $('iframe.metaframe, .dooplay_player iframe, .player iframe').first().attr('src');
        if (iframe) {
            const iframeUrl = normalizeUrl(iframe);
            const parseFlag = ['.m3u8', '.mp4', '.flv'].some(ext =>
                iframeUrl.toLowerCase().includes(ext)
            ) ? 0 : 1;

            logInfo(`Iframe解析: ${iframeUrl}`);
            return {
                urls: [{ name: "4KVM", url: iframeUrl }],
                parse: parseFlag,
                header: config.headers
            };
        }

        // 查找video标签
        const videoSrc = normalizeUrl($('video source, video').first().attr('src'));
        if (videoSrc) {
            logInfo(`Video标签解析: ${videoSrc}`);
            return {
                urls: [{ name: "4KVM", url: videoSrc }],
                parse: 0,
                header: config.headers
            };
        }

        // 使用默认播放
        logInfo(`使用默认播放: ${baseUrl}`);
        return {
            urls: [{ name: "4KVM", url: baseUrl }],
            parse: 1,
            header: config.headers
        };
    } catch (error) {
        logError("播放解析失败", error);
        return {
            urls: [{ name: "4KVM", url: playId }],
            parse: 1,
            header: config.headers
        };
    }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);