/**
 * ============================================================================
 * 荐片APP - OmniBox 爬虫脚本
 * ============================================================================
 *
 * 功能说明:
 * - 提供荐片视频APP源的 OmniBox 格式接口
 * - 支持分类浏览、搜索、详情、播放等功能
 * - 集成 Netflix 分类(放在分类列表最后)
 * - 自动屏蔽 FTP/边下边播线路,保留其他线路
 * - 搜索过滤功能,精准匹配搜索结果
 *
 * 主要特性:
 * 1. 分类支持:电影、电视剧、动漫、综艺、短剧、纪录片、Netflix
 * 2. 筛选功能:支持类型、地区、年份、排序等筛选条件
 * 3. 线路过滤:自动过滤包含"FTP"、"边下边播"、"VIP"关键字的线路
 * 4. 图片域名:自动处理图片 URL,支持多域名
 * 5. 搜索过滤:精准匹配结果,删除多余无关条目
 *
 * 日期:2025.02.27
 * ============================================================================
 */

const OmniBox = require("omnibox_sdk");

/**
 * 配置信息
 */
const jpConfig = {
  // 主 API 域名
  host: "https://h5.jianpianips1.com",
  // 图片域名
  imgHost: "https://img.jgsfnl.com",
  // 请求头
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Origin': 'https://h5.jianpianips1.com',
    'Referer': 'https://h5.jianpianips1.com/'
  },
  // 超时时间(毫秒)
  timeout: 10000
};

/**
 * 分类映射表
 */
const categoryMap = {
  '1': '电影',
  '2': '电视剧',
  '3': '动漫',
  '4': '综艺',
  '67': '短剧',
  '50': '纪录片',
  'netflix': 'Netflix'
};

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
  if (data) {
    OmniBox.log("info", `[荐片APP] ${message}: ${JSON.stringify(data)}`);
  } else {
    OmniBox.log("info", `[荐片APP] ${message}`);
  }
};

const logError = (message, error) => {
  OmniBox.log("error", `[荐片APP] ${message}: ${error.message || error}`);
};

const logWarn = (message) => {
  OmniBox.log("warn", `[荐片APP] ${message}`);
};

/**
 * 发送HTTP请求
 * @param {string} url - 请求URL
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>} 响应数据
 */
async function request(url, options = {}) {
  try {
    const response = await OmniBox.request(url, {
      method: options.method || "GET",
      headers: options.headers || jpConfig.headers,
      timeout: options.timeout || jpConfig.timeout,
      body: options.body
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
    }

    return JSON.parse(response.body);
  } catch (error) {
    logError(`请求失败: ${url}`, error);
    throw error;
  }
}

/**
 * 获取完整图片 URL
 * @param {string} path - 图片路径
 * @returns {string} 完整图片 URL
 */
const getPicUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return `${jpConfig.imgHost}${normalizedPath}`;
};

/**
 * 格式化视频列表数据
 * @param {Array} data - 原始数据
 * @returns {Array} 格式化后的列表
 */
const formatList = (data) => {
  if (!Array.isArray(data)) {
    logWarn('formatList 接收到的数据不是数组: ' + typeof data);
    return [];
  }

  return data.filter(i => i.id && String(i.id) !== '0').map(i => {
    const picPath = i.path || i.tvimg || i.tagimg || '';
    return {
      vod_id: String(i.id),
      vod_name: i.title || '未知标题',
      vod_pic: getPicUrl(picPath),
      vod_remarks: i.mask || (i.score ? `评分:${i.score}` : '')
    };
  });
};

/* ============================================================================
 * Netflix 相关功能
 * ============================================================================ */

/**
 * Netflix API 地址映射表
 */
const netflixApiMap = {
  hot_movie: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=70&page=',
  hot_tv: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=73&page=',
  hot_love: 'https://api.zxfmj.com/api/dyTag/tpl2_data?id=74&page=',
  hot_thriller: 'https://api.zxfmj.com/api/dyTag/tpl2_data?id=76&page=',
  hot_action: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=71&page=',
  top_movie: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=72&page=',
  classic_movie: 'https://api.zxfmj.com/api/special/detail?id=134',
  classic_tv: 'https://api.zxfmj.com/api/special/detail?id=131'
};

/**
 * 获取 Netflix 分类列表
 * @param {string} subType - 子分类类型
 * @param {number} page - 页码
 * @returns {Object} 列表数据
 */
const getNetflixList = async (subType, page = 1) => {
  try {
    logInfo('获取Netflix列表', { subType, page });

    const url = netflixApiMap[subType];
    if (!url) {
      logWarn(`未知的Netflix子类型: ${subType}`);
      return { list: [], page, pagecount: 1, total: 0 };
    }

    let fullUrl = url + page;
    // 经典分类不需要分页参数
    if (subType.startsWith('classic')) fullUrl = url;

    const res = await request(fullUrl);

    let data = res.data || [];
    if (!Array.isArray(data) && data.list) data = data.list;

    const list = data.map(item => ({
      vod_id: (item.id || item._id?.$oid)?.toString() + '@netflix',
      vod_name: item.title,
      vod_pic: getPicUrl(item.tvimg || item.path),
      vod_remarks: (item.mask || '') + (item.score ? ` ⭐${item.score}` : '')
    }));

    logInfo('Netflix列表获取成功', { count: list.length });

    return {
      list,
      page: parseInt(page),
      pagecount: list.length ? parseInt(page) + 1 : parseInt(page),
      limit: list.length,
      total: list.length ? 9999 : 0
    };
  } catch (e) {
    logError('Netflix列表获取失败', e);
    return { list: [], page: parseInt(page), pagecount: 1, limit: 0, total: 0 };
  }
};

/* ============================================================================
 * 首页和分类功能
 * ============================================================================ */

/**
 * 获取首页内容和分类
 * @returns {Object} 分类和筛选数据
 */
const getHomeContent = async () => {
  try {
    logInfo('========== 开始获取首页分类 ==========');

    const res = await request(`${jpConfig.host}/api/v2/settings/homeCategory`);

    if (res.code !== 1) {
      throw new Error(res.msg || '获取分类失败');
    }

    OmniBox.log('info', `[荐片APP] 分类数据: ${JSON.stringify({
      code: res.code,
      dataLength: res.data?.length
    })}`);

    const classes = [];
    const filters = {};

    // 先添加普通分类
    for (const item of res.data) {
      if (item.id === 88 || item.id === 99) continue;

      const tid = String(item.id);
      const tName = categoryMap[tid] || item.name;

      classes.push({ type_id: tid, type_name: tName });

      // 获取该分类的筛选选项
      try {
        OmniBox.log('info', `\n[荐片APP] ===== 获取分类[${tName}(${tid})]筛选选项 =====`);

        const filterUrl = `${jpConfig.host}/api/crumb/filterOptions?fcate_pid=${tid}`;
        OmniBox.log('info', `[荐片APP] 请求URL: ${filterUrl}`);

        const filterRes = await request(filterUrl);

        OmniBox.log('info', `[荐片APP] 响应code: ${filterRes.code}, hasData: ${!!filterRes.data}`);

        if (filterRes.code === 1 && filterRes.data && Array.isArray(filterRes.data)) {
          OmniBox.log('info', `[荐片APP] 筛选数据keys: ${JSON.stringify(filterRes.data.map(f => f.key))}`);

          const fts = [];
          const filterData = filterRes.data;

          // 类型筛选
          const typeFilter = filterData.find(f => f.key === 'type');
          if (typeFilter && typeFilter.data && Array.isArray(typeFilter.data)) {
            const options = typeFilter.data
              .map(t => ({ name: t.name, value: String(t.id) }))  // 改为 name/value
              .filter(t => t.name !== '全部');
            options.unshift({ name: '全部', value: '' });
            fts.push({
              name: '类型',
              key: 'type',
              init: '',  // 添加默认值
              value: options
            });
          }

          // 地区筛选
          const areaFilter = filterData.find(f => f.key === 'area');
          if (areaFilter && areaFilter.data && Array.isArray(areaFilter.data)) {
            const options = areaFilter.data
              .map(a => ({ name: a.name, value: String(a.id) }))  // 改为 name/value
              .filter(a => a.name !== '全部');
            options.unshift({ name: '全部', value: '' });
            fts.push({
              name: '地区',
              key: 'area',
              init: '',  // 添加默认值
              value: options
            });
          }

          // 年份筛选
          const yearFilter = filterData.find(f => f.key === 'year');
          if (yearFilter && yearFilter.data && Array.isArray(yearFilter.data)) {
            const options = yearFilter.data
              .map(y => ({ name: y.name, value: String(y.id) }))  // 改为 name/value
              .filter(y => y.name !== '全部');
            options.unshift({ name: '全部', value: '' });
            fts.push({
              name: '年份',
              key: 'year',
              init: '',  // 添加默认值
              value: options
            });
          }

          // 排序筛选
          const sortFilter = filterData.find(f => f.key === 'sort');
          if (sortFilter && sortFilter.data && Array.isArray(sortFilter.data)) {
            const options = sortFilter.data
              .map(s => ({ name: s.name, value: String(s.id) }))  // 改为 name/value
              .filter(s => s.name !== '全部');
            options.unshift({ name: '默认', value: '' });
            fts.push({
              name: '排序',
              key: 'sort',
              init: '',  // 添加默认值
              value: options
            });
          }

          if (fts.length > 0) {
            filters[tid] = fts;
            OmniBox.log('info', `[荐片APP] ✅ 分类[${tName}]筛选项已添加: ${fts.length}个`);
          }
        }
      } catch (e) {
        OmniBox.log('error', `[荐片APP] ❌ 获取分类[${tName}]筛选失败: ${e.message}`);
      }
    }

    // Netflix 分类
    classes.push({ type_id: 'netflix', type_name: 'Netflix' });
    filters['netflix'] = [{
      key: "cateId",
      name: "Netflix分类",
      value: [
        { n: "热播电影", v: "hot_movie" },
        { n: "热播电视剧", v: "hot_tv" },
        { n: "热播爱情片", v: "hot_love" },
        { n: "热播惊悚片", v: "hot_thriller" },
        { n: "热播动作片", v: "hot_action" },
        { n: "高分电影", v: "top_movie" },
        { n: "经典电影", v: "classic_movie" },
        { n: "经典电视剧", v: "classic_tv" }
      ]
    }];

    OmniBox.log('info', `[荐片APP] ========== 首页获取完成 ==========`);
    OmniBox.log('info', `[荐片APP] 分类数: ${classes.length}, 筛选项数: ${Object.keys(filters).length}`);

    return { class: classes, filters: filters };
  } catch (e) {
    OmniBox.log('error', `[荐片APP] ❌ 获取首页失败: ${e.message}`);
    return { class: [], filters: {} };
  }
};

/**
 * 获取首页数据
 */
async function home(params) {
  try {
    logInfo('处理首页请求');
    const homeData = await getHomeContent();
    const recommendList = await getRecommendList();

    OmniBox.log('info', `[荐片APP] 首页数据: classes=${homeData.class.length}, filters=${Object.keys(homeData.filters).length}, list=${recommendList.length}`);

    return {
      class: homeData.class,
      filters: homeData.filters,
      list: recommendList
    };
  } catch (error) {
    logError('获取首页数据失败', error);
    return {
      class: [],
      filters: {},
      list: []
    };
  }
}


/**
 * 获取分类视频列表
 * @param {string} tid - 分类 ID
 * @param {number} pg - 页码
 * @param {Object} extend - 扩展筛选参数
 * @returns {Object} 视频列表
 */
const getCategoryList = async (tid, pg = 1, extend = {}) => {
  try {
    logInfo('获取分类列表', { tid, pg, extend });

    const params = new URLSearchParams();
    params.append('fcate_pid', tid);
    params.append('page', pg);
    params.append('category_id', extend.type || '');
    params.append('area', extend.area || '');
    params.append('year', extend.year || '');
    params.append('type', '');
    params.append('sort', extend.sort || '');

    const res = await request(`${jpConfig.host}/api/crumb/list?${params.toString()}`);

    if (res.code !== 1) {
      throw new Error(res.msg || '获取列表失败');
    }

    const list = formatList(res.data);
    const hasMore = list.length >= 15;

    if (list.length > 0) {
      logInfo('列表首条数据图片', {
        name: list[0].vod_name,
        pic: list[0].vod_pic.substring(0, 80) + '...'
      });
    }

    logInfo('分类列表获取成功', { count: list.length, page: pg });

    return {
      list: list,
      page: parseInt(pg),
      pagecount: hasMore ? parseInt(pg) + 1 : parseInt(pg),
      limit: 15
    };
  } catch (e) {
    logError('获取分类列表失败', e);
    return { list: [], page: pg, pagecount: pg, limit: 15 };
  }
};

/**
 * 获取首页推荐视频
 * @returns {Array} 推荐视频列表
 */
const getRecommendList = async () => {
  try {
    logInfo('正在获取首页推荐');

    const res = await request(`${jpConfig.host}/api/dyTag/hand_data?category_id=88`);

    if (res.code !== 1 || !res.data) {
      logWarn('获取推荐数据失败或为空');
      return [];
    }

    let list = [];
    for (const key in res.data) {
      if (Array.isArray(res.data[key])) {
        list = list.concat(res.data[key]);
      }
    }

    const formatted = formatList(list);

    if (formatted.length > 0) {
      logInfo('推荐首条数据图片', {
        name: formatted[0].vod_name,
        pic: formatted[0].vod_pic.substring(0, 80) + '...'
      });
    }

    logInfo('首页推荐获取成功', { count: formatted.length });
    return formatted;
  } catch (e) {
    logError('获取首页推荐失败', e);
    return [];
  }
};

/**
 * 搜索视频
 * @param {string} wd - 搜索关键词
 * @param {number} pg - 页码
 * @returns {Object} 搜索结果
 */
const searchVod = async (wd, pg = 1) => {
  try {
    logInfo('执行搜索', { keyword: wd, page: pg });

    const params = new URLSearchParams();
    params.append('keyword', wd);
    params.append('page', pg);

    const res = await request(`${jpConfig.host}/api/v2/search/videoV2?key=${params.toString()}`);

    if (res.code !== 1) {
      logWarn('搜索接口返回错误: ' + res.msg);
      return { list: [], page: pg, pagecount: pg };
    }

    // 原始格式化
    let list = formatList(res.data);

    // =========================
    // 🔍 搜索词二次过滤(核心)
    // =========================
    const keyword = String(wd).trim().toLowerCase();

    list = list.filter(item => {
      const name = (item.vod_name || item.name || item.title || '').toLowerCase();
      return name.includes(keyword);
    });

    const hasMore = list.length >= 15;

    logInfo('搜索完成(已过滤)', {
      keyword: wd,
      count: list.length
    });

    return {
      list,
      page: parseInt(pg),
      pagecount: hasMore ? parseInt(pg) + 1 : parseInt(pg)
    };
  } catch (e) {
    logError('搜索失败', e);
    return { list: [], page: pg, pagecount: pg };
  }
};

/* ============================================================================
 * 详情和播放功能
 * ============================================================================ */

/**
 * 检查线路是否需要屏蔽
 * 屏蔽包含 VIP、FTP、常规 关键字的线路
 * @param {string} sourceName - 线路名称
 * @returns {boolean} 是否屏蔽
 */
const shouldBlockSource = (sourceName) => {
  if (!sourceName) return false;
  const name = sourceName.toLowerCase();
  return name.includes('vip') ||
    name.includes('ftp') ||
    name === '常规线路' ||
    name === '常规';
};

/**
 * 将旧格式的播放源转换为新格式(vod_play_sources)
 * @param {Array} sourceListSource - 原始播放源列表
 * @param {string} vodId - 视频ID
 * @returns {Array} 新格式的播放源列表
 */
function convertToPlaySources(sourceListSource, vodId) {
  const playSources = [];

  if (!sourceListSource || !Array.isArray(sourceListSource)) {
    return playSources;
  }

  for (const source of sourceListSource) {
    // 跳过需要屏蔽的线路
    if (shouldBlockSource(source.name)) {
      logInfo(`屏蔽线路: ${source.name}`);
      continue;
    }

    if (source.source_list && source.source_list.length > 0) {
      const episodes = source.source_list.map(item => ({
        name: item.source_name,
        playId: item.url
      }));

      playSources.push({
        name: source.name,
        episodes: episodes
      });
    }
  }

  return playSources;
}

/**
 * 获取视频详情
 * @param {string} ids - 视频 ID(可能包含 @netflix 后缀)
 * @returns {Object} 详情数据
 */
const getDetail = async (ids) => {
  try {
    logInfo('获取详情', { id: ids });

    // 处理 Netflix 类型的详情(移除 @netflix 后缀)
    const realId = ids.replace('@netflix', '');

    const res = await request(`${jpConfig.host}/api/video/detailv2?id=${realId}`);

    if (res.code !== 1 || !res.data) {
      throw new Error(res.msg || '获取详情失败');
    }

    const v = res.data;

    const picPath = v.tvimg || v.thumbnail || v.path || '';
    const fullPicUrl = getPicUrl(picPath);

    logInfo('详情图片处理', {
      original: picPath.substring(0, 50),
      full: fullPicUrl.substring(0, 80)
    });

    // 转换为新格式的播放源
    const vodPlaySources = convertToPlaySources(v.source_list_source, realId);

    logInfo('详情获取成功', {
      name: v.title,
      pic: fullPicUrl.substring(0, 50) + '...',
      sourcesCount: vodPlaySources.length
    });

    return {
      list: [{
        vod_id: ids,
        vod_name: v.title || '未知标题',
        vod_pic: fullPicUrl,
        vod_content: v.description || '',
        vod_play_sources: vodPlaySources.length > 0 ? vodPlaySources : undefined,
        vod_remarks: v.mask || (v.score ? `评分:${v.score}` : ''),
        vod_year: v.year || '',
        vod_area: v.area || '',
        vod_actor: v.actors ? v.actors.map(a => a.name).join(' ') : '',
        vod_douban_score: v.score || ''
      }]
    };
  } catch (e) {
    logError('获取详情失败', e);
    return { list: [] };
  }
};

/**
 * 处理播放请求
 * @param {string} playId - 播放地址
 * @returns {Object} 播放信息
 */
const handlePlay = async (playId) => {
  try {
    logInfo('处理播放请求', { url: playId.substring(0, 50) + '...' });

    // 构造播放响应
    const response = {
      urls: [{
        name: "播放",
        url: playId
      }],
      parse: 0,
      header: {
        'User-Agent': jpConfig.headers['User-Agent'],
        'Referer': jpConfig.host
      }
    };

    return response;
  } catch (e) {
    logError('处理播放失败', e);
    return {
      urls: [],
      parse: 0,
      header: {}
    };
  }
};

/* ============================================================================
 * OmniBox 接口实现
 * ============================================================================ */

/**
 * 获取首页数据
 * @param {Object} params - 参数对象
 * @returns {Object} 返回分类列表和推荐视频列表
 */
async function home(params) {
  try {
    logInfo('处理首页请求');
    const homeData = await getHomeContent();
    const recommendList = await getRecommendList();

    logInfo('首页数据组装完成', {
      classCount: homeData.class.length,
      recommendCount: recommendList.length
    });

    return {
      class: homeData.class,
      filters: homeData.filters,
      list: recommendList
    };
  } catch (error) {
    logError('获取首页数据失败', error);
    return {
      class: [],
      filters: {},
      list: []
    };
  }
}

/**
 * 获取分类数据
 */
async function category(params) {
  try {
    const categoryId = params.categoryId;
    const page = params.page || 1;
    const filters = params.filters || {};

    if (!categoryId) {
      throw new Error("分类ID不能为空");
    }

    logInfo(`获取分类数据: categoryId=${categoryId}, page=${page}`);

    // 处理 Netflix 分类
    if (categoryId === 'netflix') {
      let subType = filters.cateId || 'hot_movie';
      const result = await getNetflixList(subType, page);

      // 只在第一页返回筛选选项
      if (page === 1) {
        result.filters = [
          {
            key: "cateId",
            name: "Netflix分类",
            value: [
              { n: "热播电影", v: "hot_movie" },
              { n: "热播电视剧", v: "hot_tv" },
              { n: "热播爱情片", v: "hot_love" },
              { n: "热播惊悚片", v: "hot_thriller" },
              { n: "热播动作片", v: "hot_action" },
              { n: "高分电影", v: "top_movie" },
              { n: "经典电影", v: "classic_movie" },
              { n: "经典电视剧", v: "classic_tv" }
            ]
          }
        ];
      }

      return result;
    }

    // 处理普通分类
    const result = await getCategoryList(categoryId, page, filters);

    return result;
  } catch (error) {
    logError('获取分类数据失败', error);
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: []
    };
  }
}

/**
 * 获取视频详情
 * @param {Object} params - 参数对象
 *   - videoId: 视频ID(必填)
 * @returns {Object} 返回视频详情
 */
async function detail(params) {
  try {
    const videoId = params.videoId;

    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    logInfo(`获取视频详情: videoId=${videoId}`);

    return await getDetail(videoId);
  } catch (error) {
    logError('获取视频详情失败', error);
    return {
      list: []
    };
  }
}

/**
 * 搜索视频
 * @param {Object} params - 参数对象
 *   - keyword: 搜索关键词(必填)
 *   - page: 页码(可选,默认1)
 * @returns {Object} 返回搜索结果
 */
async function search(params) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = params.page || 1;

    if (!keyword) {
      return {
        page: 1,
        pagecount: 0,
        total: 0,
        list: []
      };
    }

    logInfo(`搜索视频: keyword=${keyword}, page=${page}`);

    return await searchVod(keyword, page);
  } catch (error) {
    logError('搜索视频失败', error);
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: []
    };
  }
}

/**
 * 获取播放地址
 * @param {Object} params - 参数对象
 *   - playId: 播放地址ID(必填)
 *   - flag: 播放源标识(可选)
 * @returns {Object} 返回播放地址信息
 */
async function play(params) {
  try {
    const playId = params.playId;

    if (!playId) {
      throw new Error("播放地址ID不能为空");
    }

    logInfo(`获取播放地址: playId=${playId}`);

    return await handlePlay(playId);
  } catch (error) {
    logError('获取播放地址失败', error);
    return {
      urls: [],
      parse: 0,
      header: {}
    };
  }
}

// 导出接口
module.exports = {
  home,
  category,
  search,
  detail,
  play
};

// 使用 OmniBox runner
const runner = require("spider_runner");
runner.run(module.exports);