/**
 * Sub-Store 节点重命名脚本（基于 Keywos/rename.js 二次修改）
 * 来源参考：
 * - https://raw.githubusercontent.com/Keywos/rule/main/rename.js
 * 修改后链接：
 *- https://raw.githubusercontent.com/lovechina2002/Rename/main/rename_rev.js
 *
 * 目标能力
 * 1) 常规节点：识别地区 -> 输出 “地区 + 序号 + 标签(可多项) + 倍率”，字段之间用 fgf 分隔
 * 2) 倍率识别：支持 x/×/倍率/倍、支持上标倍率 ˣ²/ˣ¹⁰ 等；未写倍率时可补 1.0倍率
 * 3) 特性标签：IPLC/IEPL/BGP/中转/优化/下载/家宽/商宽/GPT/Emby 等（blgd 开启时显示）
 * 4) 信息行白名单：包含 “剩余流量/到期/USED/TOTAL/EXPIRE …” 的行不会被 clear 过滤，且整行保持原样；
 *    若信息行中含 Emby 段，仅把 Emby 段改为 “Embyxx-倍率”，其余文本不变
 * 5) Emby 节点白名单：任何包含 Emby 的节点不参与地区识别，直接重命名为 “Embyxx-倍率”，并且不走 jxh 重新编号
 *
 * -----------------------------
 * 参数使用说明（URL # 后面写参数，多个用 & 连接）
 * -----------------------------
 *
 * 通用格式：
 *   https://raw.githubusercontent.com/xxx/rename.js#参数1&参数2=值&参数3
 *
 * 主要输入/输出语言：
 * - in=zh|cn     强制按中文地区名识别（香港/日本/美国…）
 * - in=en|us     强制按英文缩写识别（HK/JP/US…）
 * - in=flag|gq   强制按国旗识别（🇭🇰🇯🇵…；注意：前面不要先做“移除国旗”，否则识别不到）
 * - in=quan      强制按英文全称识别（Hong Kong / United States …）
 *
 * - out=zh|cn    输出中文地区名（默认）
 * - out=en|us    输出英文缩写
 * - out=flag|gq  输出国旗
 * - out=quan     输出英文全称
 *
 * 分隔符：
 * - fgf=-        “字段分隔符”，例如：香港-01-家宽-1.0倍率
 * - sn=-         “地区 与 序号”之间的分隔符，例如：香港-01-...
 * - sn=          空字符串：地区与序号之间不加任何东西，例如：香港01-...
 *   （如果不写 sn，默认是空格）
 *
 * 序号：
 * - one          如果某个地区只有一个节点，去掉 01（仅对常规地区节点有效）
 * - flag         给常规地区节点名前面加国旗（对 Emby 直出节点不适用）
 *
 * 前缀：
 * - name=ABC     给节点名加机场前缀 ABC
 * - nf           将 name= 的前缀放最前面（否则前缀放在国家后面）
 *
 * 保留/清理/过滤（谨慎使用）：
 * - blgd         显示“特性标签”（IPLC/家宽/BGP/中转/优化/下载…可多项叠加）
 * - bl           显示倍率；若节点名未包含倍率，默认补 1.0倍率
 * - nx           “不显示 1 倍率/低倍率”的过滤逻辑（原脚本已有的行为）
 * - blnx         只保留高倍率（你原脚本已有的行为）
 * - blpx         按标签/倍率分组排序（依赖 bl/blgd 命中情况）
 * - clear        清理“乱名/信息行”等（本脚本已对“剩余流量/到期”等信息行做白名单保护）
 * - key          原脚本 key 筛选逻辑（本脚本已对白名单行、Emby 行做保护）
 *
 * 自定义保留字段：
 * - blkey=IPLC+NF+GPT
 * - 支持替换：blkey=GPT>新名字+NF   表示把 GPT 替换为 “新名字”
 *
 * QUIC：
 * - blockquic=on  设置节点字段 block-quic=on
 * - blockquic=off 设置节点字段 block-quic=off
 *
 * 典型推荐用法：
 * - 常规：#blgd&bl&fgf=-&sn=
 *   例：香港01-家宽-1.0倍率
 *
 * 缓存：
 * - #noCache  常见于 Sub-Store 的“禁用缓存”写法（由 Sub-Store/前端处理；脚本里不需要额外代码）
 *
 * -----------------------------
 * 维护扩展：如何添加 “MISAKA” 这种像“家宽”一样显示的标签？
 * -----------------------------
 * 只需要改一处：TAG_DEFS（标签定义表）
 * 例如要识别 “MISAKA / Misaka / misaka”：
 *
 *   在 TAG_DEFS 里新增一行：
 *     { label: "MISAKA", re: /\bmisaka\b/i },
 *
 * 然后在启用参数 #blgd 时，就会在节点名尾巴里自动出现 MISAKA 标签。
 * （如果希望即便不开 blgd 也显示标签，那就把 collectTags 的调用从 if(blgd) 拿出来即可，但这会改变当前行为。）
 */

const inArg = $arguments || {};

// =============== 参数解析（兼容 Sub-Store：#bl 可能是空字符串） ===============
const hasArg = (k) => Object.prototype.hasOwnProperty.call(inArg, k);
const argBool = (k, def = false) => {
  if (!hasArg(k)) return def;
  const v = inArg[k];

  if (v === true) return true;
  if (v === false) return false;
  if (v === undefined || v === null) return true;

  if (typeof v === "number") return v !== 0;

  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "") return true;
    if (["1", "true", "on", "yes", "y"].includes(s)) return true;
    if (["0", "false", "off", "no", "n"].includes(s)) return false;
    return true; // 其它未知字符串：按“存在即开启”
  }

  return Boolean(v);
};

const nx = argBool("nx");
const bl = argBool("bl");
const nf = argBool("nf");
const key = argBool("key");
const blgd = argBool("blgd");
const blpx = argBool("blpx");
const blnx = argBool("blnx");
const numone = argBool("one");
const debug = argBool("debug");
const clear = argBool("clear");
const addflag = argBool("flag");
const nm = argBool("nm");

const XHFGF =
  inArg.sn === undefined
    ? " "
    : inArg.sn === true
    ? ""
    : decodeURI(String(inArg.sn)).trim();

const FGF = inArg.fgf == undefined ? " " : decodeURI(inArg.fgf);
const FNAME = inArg.name == undefined ? "" : decodeURI(inArg.name);
const BLKEY = inArg.blkey == undefined ? "" : decodeURI(inArg.blkey);
const blockquic = inArg.blockquic == undefined ? "" : decodeURI(inArg.blockquic);

const nameMap = {
  cn: "cn",
  zh: "cn",
  us: "us",
  en: "us",
  quan: "quan",
  gq: "gq",
  flag: "gq",
};

const inname = nameMap[inArg.in] || "";
const outputName = nameMap[inArg.out] || "";

// =============== 国家/地区字典 ===============
// prettier-ignore
const FG = ['🇭🇰','🇲🇴','🇹🇼','🇯🇵','🇰🇷','🇸🇬','🇺🇸','🇬🇧','🇫🇷','🇩🇪','🇦🇺','🇦🇪','🇦🇫','🇦🇱','🇩🇿','🇦🇴','🇦🇷','🇦🇲','🇦🇹','🇦🇿','🇧🇭','🇧🇩','🇧🇾','🇧🇪','🇧🇿','🇧🇯','🇧🇹','🇧🇴','🇧🇦','🇧🇼','🇧🇷','🇻🇬','🇧🇳','🇧🇬','🇧🇫','🇧🇮','🇰🇭','🇨🇲','🇨🇦','🇨🇻','🇰🇾','🇨🇫','🇹🇩','🇨🇱','🇨🇴','🇰🇲','🇨🇬','🇨🇩','🇨🇷','🇭🇷','🇨🇾','🇨🇿','🇩🇰','🇩🇯','🇩🇴','🇪🇨','🇪🇬','🇸🇻','🇬🇶','🇪🇷','🇪🇪','🇪🇹','🇫🇯','🇫🇮','🇬🇦','🇬🇲','🇬🇪','🇬🇭','🇬🇷','🇬🇱','🇬🇹','🇬🇳','🇬🇾','🇭🇹','🇭🇳','🇭🇺','🇮🇸','🇮🇳','🇮🇩','🇮🇷','🇮🇶','🇮🇪','🇮🇲','🇮🇱','🇮🇹','🇨🇮','🇯🇲','🇯🇴','🇰🇿','🇰🇪','🇰🇼','🇰🇬','🇱🇦','🇱🇻','🇱🇧','🇱🇸','🇱🇷','🇱🇾','🇱🇹','🇱🇺','🇲🇰','🇲🇬','🇲🇼','🇲🇾','🇲🇻','🇲🇱','🇲🇹','🇲🇷','🇲🇺','🇲🇽','🇲🇩','🇲🇨','🇲🇳','🇲🇪','🇲🇦','🇲🇿','🇲🇲','🇳🇦','🇳🇵','🇳🇱','🇳🇿','🇳🇮','🇳🇪','🇳🇬','🇰🇵','🇳🇴','🇴🇲','🇵🇰','🇵🇦','🇵🇾','🇵🇪','🇵🇭','🇵🇹','🇵🇷','🇶🇦','🇷🇴','🇷🇺','🇷🇼','🇸🇲','🇸🇦','🇸🇳','🇷🇸','🇸🇱','🇸🇰','🇸🇮','🇸🇴','🇿🇦','🇪🇸','🇱🇰','🇸🇩','🇸🇷','🇸🇿','🇸🇪','🇨🇭','🇸🇾','🇹🇯','🇹🇿','🇹🇭','🇹🇬','🇹🇴','🇹🇹','🇹🇳','🇹🇷','🇹🇲','🇻🇮','🇺🇬','🇺🇦','🇺🇾','🇺🇿','🇻🇪','🇻🇳','🇾🇪','🇿🇲','🇿🇼','🇦🇩','🇷🇪','🇵🇱','🇬🇺','🇻🇦','🇱🇮','🇨🇼','🇸🇨','🇦🇶','🇬🇮','🇨🇺','🇫🇴','🇦🇽','🇧🇲','🇹🇱'];
// prettier-ignore
const EN = ['HK','MO','TW','JP','KR','SG','US','GB','FR','DE','AU','AE','AF','AL','DZ','AO','AR','AM','AT','AZ','BH','BD','BY','BE','BZ','BJ','BT','BO','BA','BW','BR','VG','BN','BG','BF','BI','KH','CM','CA','CV','KY','CF','TD','CL','CO','KM','CG','CD','CR','HR','CY','CZ','DK','DJ','DO','EC','EG','SV','GQ','ER','EE','ET','FJ','FI','GA','GM','GE','GH','GR','GL','GT','GN','GY','HT','HN','HU','IS','IN','ID','IR','IQ','IE','IM','IL','IT','CI','JM','JO','KZ','KE','KW','KG','LA','LV','LB','LS','LR','LY','LT','LU','MK','MG','MW','MY','MV','ML','MT','MR','MU','MX','MD','MC','MN','ME','MA','MZ','MM','NA','NP','NL','NZ','NI','NE','NG','KP','NO','OM','PK','PA','PY','PE','PH','PT','PR','QA','RO','RU','RW','SM','SA','SN','RS','SL','SK','SI','SO','ZA','ES','LK','SD','SR','SZ','SE','CH','SY','TJ','TZ','TH','TG','TO','TT','TN','TR','TM','VI','UG','UA','UY','UZ','VE','VN','YE','ZM','ZW','AD','RE','PL','GU','VA','LI','CW','SC','AQ','GI','CU','FO','AX','BM','TL'];
// prettier-ignore
const ZH = ['香港','澳门','台湾','日本','韩国','新加坡','美国','英国','法国','德国','澳大利亚','阿联酋','阿富汗','阿尔巴尼亚','阿尔及利亚','安哥拉','阿根廷','亚美尼亚','奥地利','阿塞拜疆','巴林','孟加拉国','白俄罗斯','比利时','伯利兹','贝宁','不丹','玻利维亚','波斯尼亚和黑塞哥维那','博茨瓦纳','巴西','英属维京群岛','文莱','保加利亚','布基纳法索','布隆迪','柬埔寨','喀麦隆','加拿大','佛得角','开曼群岛','中非共和国','乍得','智利','哥伦比亚','科摩罗','刚果(布)','刚果(金)','哥斯达黎加','克罗地亚','塞浦路斯','捷克','丹麦','吉布提','多米尼加共和国','厄瓜多尔','埃及','萨尔瓦多','赤道几内亚','厄立特里亚','爱沙尼亚','埃塞俄比亚','斐济','芬兰','加蓬','冈比亚','格鲁吉亚','加纳','希腊','格陵兰','危地马拉','几内亚','圭亚那','海地','洪都拉斯','匈牙利','冰岛','印度','印尼','伊朗','伊拉克','爱尔兰','马恩岛','以色列','意大利','科特迪瓦','牙买加','约旦','哈萨克斯坦','肯尼亚','科威特','吉尔吉斯斯坦','老挝','拉脱维亚','黎巴嫩','莱索托','利比里亚','利比亚','立陶宛','卢森堡','马其顿','马达加斯加','马拉维','马来','马尔代夫','马里','马耳他','毛利塔尼亚','毛里求斯','墨西哥','摩尔多瓦','摩纳哥','蒙古','黑山共和国','摩洛哥','莫桑比克','缅甸','纳米比亚','尼泊尔','荷兰','新西兰','尼加拉瓜','尼日尔','尼日利亚','朝鲜','挪威','阿曼','巴基斯坦','巴拿马','巴拉圭','秘鲁','菲律宾','葡萄牙','波多黎各','卡塔尔','罗马尼亚','俄罗斯','卢旺达','圣马力诺','沙特阿拉伯','塞内加尔','塞尔维亚','塞拉利昂','斯洛伐克','斯洛文尼亚','索马里','南非','西班牙','斯里兰卡','苏丹','苏里南','斯威士兰','瑞典','瑞士','叙利亚','塔吉克斯坦','坦桑尼亚','泰国','多哥','汤加','特立特里尼达和多巴哥','突尼斯','土耳其','土库曼斯坦','美属维尔京群岛','乌干达','乌克兰','乌拉圭','乌兹别克斯坦','委内瑞拉','越南','也门','赞比亚','津巴布韦','安道尔','留尼汪','波兰','关岛','梵蒂冈','列支敦士登','库拉索','塞舌尔','南极','直布罗陀','古巴','法罗群岛','奥兰群岛','百慕达','东帝汶'];
// prettier-ignore
const QC = ['Hong Kong','Macao','Taiwan','Japan','Korea','Singapore','United States','United Kingdom','France','Germany','Australia','Dubai','Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','British Virgin Islands','Brunei','Bulgaria','Burkina-faso','Burundi','Cambodia','Cameroon','Canada','CapeVerde','CaymanIslands','Central African Republic','Chad','Chile','Colombia','Comoros','Congo-Brazzaville','Congo-Kinshasa','CostaRica','Croatia','Cyprus','Czech Republic','Denmark','Djibouti','Dominican Republic','Ecuador','Egypt','EISalvador','Equatorial Guinea','Eritrea','Estonia','Ethiopia','Fiji','Finland','Gabon','Gambia','Georgia','Ghana','Greece','Greenland','Guatemala','Guinea','Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Isle of Man','Israel','Italy','Ivory Coast','Jamaica','Jordan','Kazakstan','Kenya','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Lithuania','Luxembourg','Macedonia','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Mauritania','Mauritius','Mexico','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar(Burma)','Namibia','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','NorthKorea','Norway','Oman','Pakistan','Panama','Paraguay','Peru','Philippines','Portugal','PuertoRico','Qatar','Romania','Russia','Rwanda','SanMarino','SaudiArabia','Senegal','Serbia','SierraLeone','Slovakia','Slovenia','Somalia','SouthAfrica','Spain','SriLanka','Sudan','Suriname','Swaziland','Sweden','Switzerland','Syria','Tajikstan','Tanzania','Thailand','Togo','Tonga','TrinidadandTobago','Tunisia','Turkey','Turkmenistan','U.S.Virgin Islands','Uganda','Ukraine','Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe','Andorra','Reunion','Poland','Guam','Vatican','Liechtensteins','Curacao','Seychelles','Antarctica','Gibraltar','Cuba','Faroe Islands','Ahvenanmaa','Bermuda','Timor-Leste'];

// =============== 清理/白名单 ===============
const nameclear =
  /(套餐|到期|有效|剩余|版本|已用|过期|失联|测试|官方|网址|备用|群|TEST|客服|网站|获取|订阅|流量|机场|下次|官址|联系|邮箱|工单|学术|USE|USED|TOTAL|EXPIRE|EMAIL)/i;

// 信息行白名单：不允许被 clear 过滤，且整行不走 jxh 编号重命名
const INFO_LINE_RE = /(剩余\s*流量|套餐\s*到期|到期|流量|剩余|USE|USED|TOTAL|EXPIRE)/i;

// Emby 白名单（emoji/符号都可）
const EMBY_RE = /Emby/i;

// =============== 标签定义（改这里就能增删标签） ===============
const TAG_DEFS = [
  { label: "IPLC", re: /IPLC/i },
  { label: "IEPL", re: /IEPL/i },
  { label: "BGP", re: /(BGP|B-G-P)/i },
  { label: "中转", re: /(中转|中轉|relay|transit|transfer)/i },
  { label: "优化", re: /(优化|優化|opt|optimize|optimization)/i },
  { label: "下载", re: /(下载|下載|download|\bdl\b)/i },
  { label: "Kern", re: /核心/ },
  { label: "Edge", re: /边缘/ },
  { label: "Pro", re: /高级/ },
  { label: "Std", re: /标准/ },
  { label: "Exp", re: /实验/ },
  { label: "商宽", re: /(商宽|BIZ)/i },
  { label: "家宽", re: /(家宽|RES|HOME|FAM|🏠)/i },
  { label: "Game", re: /游戏|game/i },
  { label: "Buy", re: /购物/ },
  { label: "Zx", re: /专线/ },
  { label: "LB", re: /LB/ },
  { label: "CF", re: /cloudflare/i },
  { label: "UDP", re: /\budp\b/i },
  { label: "GPT", re: /\bgpt\b/i },
  { label: "Emby", re: /emby/i },

  // 例如以后要加 MISAKA，就在这里加：
  // { label: "MISAKA", re: /\bmisaka\b/i },

  { label: "UDPN", re: /udpn\b/i },
  { label: "BT", re: /\bBT\b/i },
  { label: "ISP", re: /\bISP\b/i },
  { label: "Premium", re: /\bPremium\b/i },
];

// 排序辅助：命中这些特征/倍率的节点会被放进 special 组（用于 blpx）
const specialRegex = [
  /(\d\.)?\d+(×|倍率)/i,
  /ˣ[⁰¹²³⁴⁵⁶⁷⁸⁹0-9˙.·⁻-]+/i,
  ...TAG_DEFS.map((d) => d.re),
];

// 高倍/倍率过滤
const nameblnx = /(高倍|(?!1)\d+(?:\.\d+)?(x|倍|倍率)|ˣ[⁰¹²³⁴⁵⁶⁷⁸⁹0-9˙.·⁻-]+)/i;
const namenx = /(高倍|(?!1)\d+(?:\.\d+)?(x|倍|倍率)|ˣ[⁰¹²³⁴⁵⁶⁷⁸⁹0-9˙.·⁻-]+)/i;

// key 过滤
const keya =
  /港|Hong|HK|新加坡|SG|Singapore|日本|Japan|JP|美国|United States|US|韩|土耳其|TR|Turkey|Korea|KR|🇸🇬|🇭🇰|🇯🇵|🇺🇸|🇰🇷|🇹🇷/i;
const keyb =
  /(((1|2|3|4)\d)|(香港|Hong|HK) 0[5-9]|((新加坡|SG|Singapore|日本|Japan|JP|美国|United States|US|韩|土耳其|TR|Turkey|Korea|KR) 0[3-9]))/i;

// 预处理映射
const rurekey = {
  GB: /UK/g,
  "B-G-P": /BGP/g,
  "Russia Moscow": /Moscow/g,
  "Korea Chuncheon": /Chuncheon|Seoul/g,
  "Hong Kong": /Hongkong|HONG KONG/gi,
  "United Kingdom London": /London|Great Britain/g,
  "Dubai United Arab Emirates": /United Arab Emirates/g,
  "Taiwan TW 台湾 🇹🇼": /(台|Tai\s?wan|TW).*?🇨🇳|🇨🇳.*?(台|Tai\s?wan|TW)/g,
  "United States": /USA|Los Angeles|San Jose|Silicon Valley|Michigan/g,
  澳大利亚: /澳洲|墨尔本|悉尼|土澳|(深|沪|呼|京|广|杭)澳/g,
  德国: /(深|沪|呼|京|广|杭)德(?!.*(I|线))|法兰克福|滬德/g,
  香港: /(深|沪|呼|京|广|杭)港(?!.*(I|线))/g,
  日本: /(深|沪|呼|京|广|杭|中|辽)日(?!.*(I|线))|东京|大坂/g,
  新加坡: /狮城|(深|沪|呼|京|广|杭)新/g,
  美国: /(深|沪|呼|京|广|杭)美|波特兰|芝加哥|哥伦布|纽约|硅谷|俄勒冈|西雅图|芝加哥/g,
  波斯尼亚和黑塞哥维那: /波黑共和国/g,
  印尼: /印度尼西亚|雅加达/g,
  印度: /孟买/g,
  阿联酋: /迪拜|阿拉伯联合酋长国/g,
  孟加拉国: /孟加拉/g,
  捷克: /捷克共和国/g,
  台湾: /新台|新北|台(?!.*线)/g,
  Taiwan: /Taipei/g,
  韩国: /春川|韩|首尔/g,
  Japan: /Tokyo|Osaka/g,
  英国: /伦敦/g,
  India: /Mumbai/g,
  Germany: /Frankfurt/g,
  Switzerland: /Zurich/g,
  俄罗斯: /莫斯科/g,
  土耳其: /伊斯坦布尔/g,
  泰国: /泰國|曼谷/g,
  法国: /巴黎/g,
  G: /\d\s?GB/gi,
  Esnc: /esnc/gi,
};

let GetK = false;
let AMK = [];
function ObjKA(i) {
  GetK = true;
  AMK = Object.entries(i);
}

// =============== 工具函数 ===============
const uniq = (arr) => arr.filter((v, i, a) => a.indexOf(v) === i);

function getList(arg) {
  switch (arg) {
    case "us":
      return EN;
    case "gq":
      return FG;
    case "quan":
      return QC;
    default:
      return ZH;
  }
}

function formatRate(numStr) {
  const n = Number(numStr);
  if (!Number.isFinite(n)) return String(numStr);

  if (!String(numStr).includes(".")) return n.toFixed(1);

  let s = String(numStr).replace(/0+$/, "");
  s = s.replace(/\.$/, "");
  if (!s.includes(".")) s = s + ".0";
  return s;
}

/**
 * 通用倍率识别
 * 支持：0.1x / x0.2 / 6x / 3倍 / 5.00倍率 / ×1.5 等
 * 支持上标倍率：ˣ² / ˣ¹˙⁵ 等
 * 默认：1.0倍率
 */
const SUP_MAP = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "˙": ".",
  ".": ".",
  "·": ".",
  "⁻": "-",
  "-": "-",
};

function parseNormalRate(name) {
  const m = name.match(
    /(?:倍率|[xX×])\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*(?:倍|倍率|[xX×])/
  );
  if (!m) return "";
  const raw = (m[1] || m[2] || "").trim();
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  return `${formatRate(raw)}倍率`;
}

function parseXRate(name) {
  const m = name.match(/ˣ([⁰¹²³⁴⁵⁶⁷⁸⁹0-9˙.·⁻-]+)/);
  if (!m) return "";
  const seq = m[1];
  let s = "";
  for (const ch of seq) {
    if (SUP_MAP[ch] === undefined) return "";
    s += SUP_MAP[ch];
  }

  if (s.startsWith(".")) s = "0" + s;
  if (s.endsWith(".")) s = s.slice(0, -1);

  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  return `${formatRate(String(s))}倍率`;
}

function getRateUnified(name) {
  const normal = parseNormalRate(name);
  if (normal) return normal;

  const xrate = parseXRate(name);
  if (xrate) return xrate;

  return "1.0倍率";
}

function getEmbyRate(seg) {
  const mx = seg.match(/[xX×]\s*([0-9]+(?:\.[0-9]+)?)/);
  if (mx) {
    const v = Number(mx[1]);
    if (Number.isFinite(v) && v > 0) return `${formatRate(mx[1])}倍率`;
  }
  return getRateUnified(seg);
}

function makeEmbyNodeName(original) {
  const m = original.match(/Emby[^0-9]*0*([0-9]{1,3})/i);
  const idx = String(m ? Number(m[1]) : 1).padStart(2, "0");
  const rate = getEmbyRate(original);
  return `Emby${idx}${FGF}${rate}`;
}

function rewriteEmbyInInfoLine(line) {
  // 捕获 “Emby 01 ...倍率/ x0.2 ...” 的片段（不依赖 \b）
  const re =
    /Emby\s*0*[0-9]{1,3}(?:\s*(?:[xX×]\s*[0-9]+(?:\.[0-9]+)?)|\s*[0-9]+(?:\.[0-9]+)?\s*(?:倍|倍率)|\s*(?:倍|倍率)\s*[0-9]+(?:\.[0-9]+)?)?/i;

  const m = line.match(re);
  if (!m) return line;

  const newToken = makeEmbyNodeName(m[0]);
  return line.replace(m[0], newToken);
}

function collectTags(name) {
  const tags = [];
  for (const d of TAG_DEFS) {
    if (d.re.test(name)) tags.push(d.label);
  }
  return uniq(tags);
}

// =============== 主逻辑 ===============
function operator(proxies = [], targetPlatform, context) {
  const Allmap = {};
  const outList = getList(outputName);

  const inputList =
    inname !== "" ? [getList(inname)] : [ZH, FG, QC, EN];

  inputList.forEach((arr) => {
    arr.forEach((value, valueIndex) => {
      Allmap[value] = outList[valueIndex];
    });
  });

  // 过滤阶段：信息行 + Emby 行 一律不走过滤（避免 clear/nx/blnx/key 误杀）
  if (clear || nx || blnx || key) {
    proxies = proxies.filter((res) => {
      const name = res.name || "";
      const isInfoLine = INFO_LINE_RE.test(name);
      const isEmby = EMBY_RE.test(name);
      const bypass = isInfoLine || isEmby;

      const shouldKeep =
        !(clear && nameclear.test(name) && !bypass) &&
        !(nx && namenx.test(name) && !bypass) &&
        !(blnx && !nameblnx.test(name) && !bypass) &&
        !(key && !(keya.test(name) && /2|4|6|7/i.test(name)) && !bypass);

      return shouldKeep;
    });
  }

  const BLKEYS = BLKEY ? BLKEY.split("+") : [];
  let retainKey = "";

  proxies.forEach((e) => {
    let bktf = false;
    const originalName = e.name || "";

    // 1) 信息行：整行原样，只替换 Emby 段，且不参与 jxh
    if (INFO_LINE_RE.test(originalName)) {
      if (EMBY_RE.test(originalName)) e.name = rewriteEmbyInInfoLine(originalName);
      e.__skipJxh = true;
      return;
    }

    // 2) Emby 普通节点：直接改名为 Embyxx-倍率，且不参与 jxh
    if (EMBY_RE.test(originalName)) {
      e.name = makeEmbyNodeName(originalName);
      e.__skipJxh = true;
      return;
    }

    // ====== 地区识别/保留字段逻辑 ======
    Object.keys(rurekey).forEach((ikey) => {
      if (rurekey[ikey].test(e.name)) {
        e.name = e.name.replace(rurekey[ikey], ikey);

        if (BLKEY) {
          bktf = true;
          let BLKEY_REPLACE = "";
          let re = false;

          BLKEYS.forEach((i) => {
            if (i.includes(">") && originalName.includes(i.split(">")[0])) {
              if (rurekey[ikey].test(i.split(">")[0])) {
                e.name += " " + i.split(">")[0];
              }
              if (i.split(">")[1]) {
                BLKEY_REPLACE = i.split(">")[1];
                re = true;
              }
            } else {
              if (originalName.includes(i)) {
                e.name += " " + i;
              }
            }
            retainKey = re
              ? BLKEY_REPLACE
              : BLKEYS.filter((items) => e.name.includes(items));
          });
        }
      }
    });

    // QUIC
    if (blockquic === "on") e["block-quic"] = "on";
    else if (blockquic === "off") e["block-quic"] = "off";
    else delete e["block-quic"];

    // 自定义保留字段（rurekey 未命中时也可保留）
    if (!bktf && BLKEY) {
      let BLKEY_REPLACE = "";
      let re = false;

      BLKEYS.forEach((i) => {
        if (i.includes(">") && e.name.includes(i.split(">")[0])) {
          if (i.split(">")[1]) {
            BLKEY_REPLACE = i.split(">")[1];
            re = true;
          }
        }
      });

      retainKey = re
        ? BLKEY_REPLACE
        : BLKEYS.filter((items) => e.name.includes(items));
    }

    // 标签与倍率
    const needRate = bl || blgd;
    const tags = blgd ? collectTags(e.name) : [];
    const rate = needRate ? getRateUnified(e.name) : "";

    // 地区匹配表构建
    if (!GetK) ObjKA(Allmap);

    const findKey = AMK.find(([k]) => e.name.includes(k));
    let firstName = "";
    let nNames = "";
    if (nf) firstName = FNAME;
    else nNames = FNAME;

    if (findKey?.[1]) {
      const findKeyValue = findKey[1];

      let usflag = "";
      if (addflag) {
        const index = outList.indexOf(findKeyValue);
        if (index !== -1) {
          usflag = FG[index];
          usflag = usflag === "🇹🇼" ? "🇨🇳" : usflag;
        }
      }

      // 基名：用于分组编号（不含倍率/标签）
      const baseParts = uniq([firstName, usflag, nNames, findKeyValue].filter(Boolean));

      // 尾巴：保留字段 + 标签(多项) + 倍率
      const tailParts = uniq([retainKey, ...tags, rate].filter((k) => k !== "" && k?.length !== 0));

      e.__baseName = baseParts.join(FGF);
      e.__tailName = tailParts.join(FGF);

      e.name = e.__tailName ? `${e.__baseName}${FGF}${e.__tailName}` : e.__baseName;
    } else {
      // 未识别地区：nm 保留，否则丢弃
      if (nm) e.name = (FNAME ? FNAME + FGF : "") + e.name;
      else e.name = null;
    }
  });

  proxies = proxies.filter((e) => e.name !== null);

  jxh(proxies);
  if (numone) oneP(proxies);
  if (blpx) proxies = fampx(proxies);
  if (key) proxies = proxies.filter((e) => !keyb.test(e.name));

  return proxies;
}

// 按地区基名编号（Emby/信息行会跳过）
function jxh(proxies) {
  const counter = Object.create(null);
  for (const p of proxies) {
    if (p.__skipJxh) continue;

    const base = p.__baseName || p.name;
    counter[base] = (counter[base] || 0) + 1;

    const idx = String(counter[base]).padStart(2, "0");
    const tail = p.__tailName || "";

    p.name = tail ? `${base}${XHFGF}${idx}${FGF}${tail}` : `${base}${XHFGF}${idx}`;
  }
  return proxies;
}

// 仅一个节点的地区去掉 01
function oneP(proxies) {
  const t = proxies.reduce((acc, item) => {
    const n = item.name.replace(/[^A-Za-z0-9\u00C0-\u017F\u4E00-\u9FFF]+\d+$/, "");
    if (!acc[n]) acc[n] = [];
    acc[n].push(item);
    return acc;
  }, {});
  for (const k in t) {
    if (t[k].length === 1 && t[k][0].name.endsWith("01")) {
      t[k][0].name = t[k][0].name.replace(/[^.]01/, "");
    }
  }
  return proxies;
}

// 特征排序
function fampx(proxies) {
  const wis = [];
  const wnout = [];
  for (const proxy of proxies) {
    const hit = specialRegex.some((re) => re.test(proxy.name));
    if (hit) wis.push(proxy);
    else wnout.push(proxy);
  }

  const sps = wis.map((proxy) => specialRegex.findIndex((re) => re.test(proxy.name)));
  wis.sort(
    (a, b) =>
      sps[wis.indexOf(a)] - sps[wis.indexOf(b)] || a.name.localeCompare(b.name)
  );
  wnout.sort((a, b) => proxies.indexOf(a) - proxies.indexOf(b));
  return wnout.concat(wis);
}

// 兼容 Node 导出（不影响 Sub-Store）
if (typeof module !== "undefined") module.exports = operator;
