// How Mongolian customers type, reduced to one spelling (adapted from the Lorentz engine's
// textNorm.ts). Customers write Cyrillic, Mongolian in Latin letters ("margaash 3 tsagt"),
// glued words ("hedve", "bnuu"), slang and typos, and sometimes English. normText() maps all of
// it to lower-case Cyrillic words so every intent pattern is written once; phoneticTokens()
// maps Cyrillic and Latin to one rough Latin spelling for typo-tolerant vocabulary matching
// (service and specialist names, FAQ questions). Nothing here knows the salon's catalogue.

const TSAG_SUFFIX: Record<string, string> = {
  aa: 'аа',
  ee: 'ээ',
  t: 'т',
  taa: 'таа',
  aas: 'аас',
  iin: 'ийн',
  tai: 'тай',
  uud: 'ууд',
}

/** Latin (and English) spellings → the Cyrillic word the intent patterns use. Longer forms first. */
const ALIASES: [RegExp, string | ((match: string, ...groups: string[]) => string)][] = [
  // Glued question endings
  [/\b(?:une\s*hed\s*(?:ve|we|be)|unehedve|vnehedve)\b/g, 'үнэ хэд вэ'],
  [/\b(?:hed\s*(?:ve|we|be)|hedve|hedwe|hedvee|hedbe)\b/g, 'хэд вэ'],
  [/\b(?:bga\s*yu|bgaa\s*yu|bgayu|bgaayu|baigaa\s*yu|baigaayu)\b/g, 'байгаа юу'],
  [/\b(?:bn\s*uu|bnuu|bnu|baina\s*uu|bainuu|bna\s*uu)\b/g, 'байна уу'],
  [/\b(?:bolh\s*uu|bolhuu|bolohuu|boloh\s*uu|bolno\s*uu|bolnuu|bolhoor)\b/g, 'болох уу'],
  [/\b(?:bolomjtoi\s*yu|bolomjtoi\s*uu|bolomjtoiyu)\b/g, 'боломжтой юу'],
  [/\b(?:sain\s*baina\s*uu|sain\s*bnu|sain\s*bn\s*uu|sainuu|sn\s*bnu|sain\s*uu)\b/g, 'сайн байна уу'],
  [/\b(?:udees\s*hoish|udees\s*hoishoo|udiin\s*daraa)\b/g, 'үдээс хойш'],
  [/\b(?:her\s*udaan|hr\s*udaan|khr\s*udaan)\b/g, 'хэр удаан'],
  [/\b(?:day\s+after\s+tomorrow)\b/g, 'нөгөөдөр'],
  // Days and parts of the day
  [/\b(?:unuudur|onoodor|unoodor|unuudr|onoodr|unuudriin|onoodriin|unudur|onodor|today)\b/g, 'өнөөдөр'],
  [/\b(?:margaash|margash|margaashn|magaash|margaasha|margaashaa|margaashiin|margashiin|maragaash|tomorrow|tmrw)\b/g, 'маргааш'],
  [/\b(?:nuguudur|nogoodor|nuguudr|nogoodr|nuguudriin|nogoodriin|nugoodor|nogoodur)\b/g, 'нөгөөдөр'],
  [/\b(?:davaa|davaagiin|monday|mon)\b/g, 'даваа'],
  [/\b(?:myagmar|mygmar|myagmr|myagmariin|tuesday|tue|tues)\b/g, 'мягмар'],
  [/\b(?:lhagva|lhgva|lkhagva|lhagvagiin|wednesday|wed)\b/g, 'лхагва'],
  [/\b(?:purev|pvrev|pürev|purew|purviin|thursday|thu|thur|thurs)\b/g, 'пүрэв'],
  [/\b(?:baasan|basan|baasangiin|friday|fri)\b/g, 'баасан'],
  [/\b(?:byamba|bymba|biamba|byambiin|bymbiin|saturday|sat)\b/g, 'бямба'],
  [/\b(?:nyam|nym|niam|nyamiin|sunday|sun)\b/g, 'ням'],
  [/\b(?:garag|garig|garagt|garigt|garagiin|gariguud)\b/g, 'гараг'],
  [/\b(?:oroi|oroy|oroin|oroinii|evening|tonight)\b/g, 'орой'],
  [/\b(?:ugluu|ogloo|ugluunii|oglooni|ugluuni|morning)\b/g, 'өглөө'],
  [/\b(?:afternoon)\b/g, 'үдээс хойш'],
  [/\b(?:hagas|hagast|half)\b/g, 'хагас'],
  [/\b(?:hurtel|hurtl|khurtel|until)\b/g, 'хүртэл'],
  [/\b(?:hoish|hoishoo|after)\b/g, 'хойш'],
  [/\b(?:doloo\s*honog|7\s*honog|week)\b/g, 'долоо хоног'],
  [/\b(?:daraa|daraah|daraagiin|next)\b/g, 'дараа'],
  [/\b(?:ireh|irh|irhe|ireh\s*doloo)\b/g, 'ирэх'],
  [/\b(?:sariin|sard|saryn)\b/g, 'сарын'],
  // Booking verbs and the "time / appointment" noun
  [/\b(?:tsag|cag|tsg)(aa|ee|taa|t|aas|iin|tai|uud)?\b/g, (_m, suffix?: string) => `цаг${TSAG_SUFFIX[suffix ?? ''] ?? ''}`],
  [/\b(?:udur|odor|udriin|odriin|udrin|day)\b/g, 'өдөр'],
  [/\b(?:zahialga|zahialgaa|zahialgiin|zahialgyn|zahialgaar|zahialg|booking|appointment|reservation)\b/g, 'захиалга'],
  [/\b(?:zahialmaar|zahialmar|zahialya|zahialii|zahialiya|zahialy|zahialna|zahialah|zahialh|zahialj|zahialaad|zahial|book|reserve|schedule)\b/g, 'захиалах'],
  [/\b(?:avmaar|avmar|awmaar|avii|avya|aviya|avay|avna|avah|avch|avj|awii|awya)\b/g, 'авах'],
  [/\b(?:hiilgemeer|hiilgemer|hiilgemeer|hiilgeh|hiilgeye|hiilgey|hiilgej|hiilgene|hiilgehed|hiilgeh\w*)\b/g, 'хийлгэх'],
  [/\b(?:hiideg|hiidg|hiidgiin)\b/g, 'хийдэг'],
  [/\b(?:hiih|hiine|hiij)\b/g, 'хийх'],
  [/\b(?:sul|chuluutei|free|available|availability|open\s*slot)\b/g, 'сул'],
  [/\b(?:boloh|bolh)\b/g, 'болох'],
  [/\b(?:bolno|bolnoo|bolnooo|boln)\b/g, 'болно'],
  [/\b(?:bolomjtoi|bolomjtoy|bolomj)\b/g, 'боломжтой'],
  [/\b(?:bolgochih|bolgoy|bolgoyo|bolgoorai|bolgooch|bolgoh|bolgo|bolgoj)\b/g, 'болгох'],
  // Cancel and change
  [/\b(?:tsuts\w*|cucl\w*|tsucl\w*|tsutl\w*|cancel\w*)\b/g, 'цуцлах'],
  [/\b(?:uurchl\w*|oorchl\w*|uurchil\w*|oorchil\w*|urchl\w*|orchl\w*|reschedul\w*)\b/g, 'өөрчлөх'],
  [/\b(?:soliulah|soliulmaar|soliulj|solih|solij|solimoor|soliyo)\b/g, 'солих'],
  [/\b(?:hoishluul\w*|hoishlo\w*|postpone)\b/g, 'хойшлуулах'],
  [/\b(?:shiljuul\w*|move)\b/g, 'шилжүүлэх'],
  // Services and body parts
  [/\b(?:manikyur\w*|manikur\w*|manikiur\w*|manicure\w*|manikyr\w*|manik)\b/g, 'маникюр'],
  [/\b(?:pedikyur\w*|pedikur\w*|pedicure\w*|pedik)\b/g, 'педикюр'],
  [/\b(?:gel|geliin|geltei|geliig|gelee|geleer|gell)\b/g, 'гель'],
  [/\b(?:budalt|budlt|budah|budaltaa|budaltiin|budaltai|polish|lacquer|lak)\b/g, 'будалт'],
  [/\b(?:sungalt|sungaltiin|sunglt|sungaltaa|sunguulah|sunguulmaar|sungah|extensions?)\b/g, 'сунгалт'],
  [/\b(?:akril|akryl|acrylic|akrilan)\b/g, 'акрил'],
  [/\b(?:tips|tipsee|tipseer)\b/g, 'типс'],
  [/\b(?:nuhult|noholt|nohvvlt|nuhuult|nuhuulah|nuhuuleh|refill|fill)\b/g, 'нөхөлт'],
  [/\b(?:zasvar|zasvr|zasuulah|zasuulmaar|zasah|repair)\b/g, 'засвар'],
  [/\b(?:zurag|zuragtai|zurgiin|art)\b/g, 'зураг'],
  [/\b(?:dizain|dizaain|design)\b/g, 'дизайн'],
  [/\b(?:frants|franc|french|frantsiin|frantz)\b/g, 'франц'],
  [/\b(?:chimeglel|chimegl|decoration)\b/g, 'чимэглэл'],
  [/\b(?:chuluu|chuluun|chulu|rhinestones?|stones?)\b/g, 'чулуун'],
  [/\b(?:parafin|paraffin|parafinii)\b/g, 'парафин'],
  [/\b(?:archilgaa|archilgaanii|archlah|care)\b/g, 'арчилгаа'],
  [/\b(?:avalt|removal|remove)\b/g, 'авалт'],
  [/\b(?:behjuulelt|bekhjuulelt|behjuuleh|bekhjuuleh|strengthening)\b/g, 'бэхжүүлэлт'],
  [/\b(?:hums|khums|humsnii|humsee|humsaa|hvms|humsuu|humsiig|homs|nails?)\b/g, 'хумс'],
  [/\b(?:hul|khul|huliin|holiin|feet|foot)\b/g, 'хөл'],
  [/\b(?:gariin|hand|hands)\b/g, 'гарын'],
  [/\b(?:eregtei|erregtei|ereg|men'?s|male)\b/g, 'эрэгтэй'],
  [/\b(?:songodog|songodg|classic)\b/g, 'сонгодог'],
  [/\b(?:engiin|engin|basic|simple|regular)\b/g, 'энгийн'],
  [/\b(?:premium|premiym)\b/g, 'премиум'],
  [/\b(?:hrom|chrome|khrom)\b/g, 'хром'],
  [/\b(?:uilchilgee\w*|vilchilgee\w*|uilchilg\w*|services?)\b/g, 'үйлчилгээ'],
  // Question words
  [/\b(?:une|vne|unii|uniin|unetei|unee|price|prices|cost)\b/g, 'үнэ'],
  [/\b(?:hed|hedi|hediin|hedee)\b/g, 'хэд'],
  [/\b(?:heden|hedn|hedenn)\b/g, 'хэдэн'],
  [/\b(?:hugatsaa|hugtsaa|hugatsaatai|hugatsaand|duration)\b/g, 'хугацаа'],
  [/\b(?:oroh|orno|orood|orj)\b/g, 'орох'],
  [/\b(?:urgeljleh|vrgeljleh|urgeljilne|vrgeljilne|urgeljlene)\b/g, 'үргэлжлэх'],
  [/\b(?:minut|minute|minutes|mins?)\b/g, 'минут'],
  [/\b(?:yamar|ymar|ymr|yamr)\b/g, 'ямар'],
  [/\b(?:hen|khen)\b/g, 'хэн'],
  [/\b(?:haana|hana|khaana)\b/g, 'хаана'],
  [/\b(?:hezee|hzee|khezee)\b/g, 'хэзээ'],
  [/\b(?:yaaj|yaj|yj|herhen)\b/g, 'яаж'],
  [/\b(?:yaah|yah)\b/g, 'яах'],
  [/\b(?:ve|we|vee|wee)\b/g, 'вэ'],
  [/\b(?:be)\b/g, 'бэ'],
  [/\b(?:yu|yuu)\b/g, 'юу'],
  [/\b(?:uu|vv)\b/g, 'уу'],
  [/\b(?:bga|bgaa|baigaa|bdag|baidag|bdg)\b/g, 'байдаг'],
  [/\b(?:baina|bn|bna|bainaa)\b/g, 'байна'],
  // Salon information
  [/\b(?:hayag|hayg|hayagaa|address)\b/g, 'хаяг'],
  [/\b(?:bairshil|bairshiliin|location|located)\b/g, 'байршил'],
  [/\b(?:utas|utasnii|utsaa|utasaa|utsnii|phone)\b/g, 'утас'],
  [/\b(?:dugaar|dugaariig|dugaaraa|dugar|number)\b/g, 'дугаар'],
  [/\b(?:ajliin|ajlin|ajlyn)\b/g, 'ажлын'],
  [/\b(?:ajilladag|ajildag|ajilladg|ajillah|ajillana)\b/g, 'ажилладаг'],
  [/\b(?:ongoidog|ongoiddog|ongoih|ongoino|neegdeh|neeh|neelttei)\b/g, 'онгойдог'],
  [/\b(?:haadag|haah|haana\s*vee)\b/g, 'хаадаг'],
  [/\b(?:amardag|amrah|amarna|amralt\w*)\b/g, 'амардаг'],
  [/\b(?:urdchilgaa\w*|uridchilgaa\w*|urid\s*tulbur|deposit)\b/g, 'урьдчилгаа'],
  [/\b(?:tulbur|tulbor|tolbor|tulburiig|payment)\b/g, 'төлбөр'],
  [/\b(?:tulsun|tulsen|tulchihlu|tulchihlee|tulchihsun|tullee|shiljuulsen|shiljuulchihlee|paid)\b/g, 'төлсөн'],
  [/\b(?:tuluh|tulnu|tulj|tulh|toloh|tulne|pay)\b/g, 'төлөх'],
  [/\b(?:kart|kartaar|card)\b/g, 'карт'],
  [/\b(?:belen|beleneer|cash)\b/g, 'бэлэн'],
  [/\b(?:butsaah|butsaana|butsaaj|butsaalt|refund)\b/g, 'буцаах'],
  [/\b(?:mungu|mongo|mungiig|mungoo|money)\b/g, 'мөнгө'],
  [/\b(?:zogsool|zogsooltoi|parking|parkovka)\b/g, 'зогсоол'],
  [/\b(?:beleg|belgiin|belgin|gift|voucher)\b/g, 'бэлэг'],
  [/\b(?:busad|other|others)\b/g, 'бусад'],
  [/\b(?:hereglegch\w*|hereglegc\w*|customers?|clients?)\b/g, 'хэрэглэгч'],
  [/\b(?:uilchluulegch\w*|vilchluulegch\w*)\b/g, 'үйлчлүүлэгч'],
  // People and hand-over
  [/\b(?:huntei|hvntei|khuntei|humuustei)\b/g, 'хүнтэй'],
  [/\b(?:hun|hvn|khun|person|human)\b/g, 'хүн'],
  [/\b(?:ajiltan\w*|staff)\b/g, 'ажилтан'],
  [/\b(?:yarih|yarimaar|yariya|yarya|talk|speak)\b/g, 'ярих'],
  [/\b(?:holbogdoh|holbogdmoor|holbogdoj|holboo|holbood|holboj|connect)\b/g, 'холбогдох'],
  [/\b(?:master|mastar|mastert|masteriin)\b/g, 'мастер'],
  [/\b(?:mergejilten\w*|mergeshsen|specialists?|technicians?)\b/g, 'мэргэжилтэн'],
  [/\b(?:gomdol|gomdoltoi|complaint|complain)\b/g, 'гомдол'],
  [/\b(?:hugarsan|hugarchihlaa|hugarchihsan|hugarchlaa|broke|broken)\b/g, 'хугарсан'],
  // Replies
  [/\b(?:tiim|tim|tiimee|tiimaa|tiimeee|yes|yeah|yep|yup)\b/g, 'тийм'],
  [/\b(?:za|zaa|zaza|zaaza)\b/g, 'за'],
  [/\b(?:ugui|ugvi|ugyi|vgui|nope)\b/g, 'үгүй'],
  [/\b(?:bish)\b/g, 'биш'],
  [/\b(?:bolih|bolio|boliyo|bolilloo|bolichii|boliul)\b/g, 'болих'],
  [/\b(?:zuv|zov|correct)\b/g, 'зөв'],
  [/\b(?:bayarlalaa|bayrlalaa|bayrla|bayarla|bayrlaa|bairlalaa|thanks|thank\s*you|thx)\b/g, 'баярлалаа'],
  [/\b(?:minii|mini|my)\b/g, 'миний'],
  [/\b(?:ene|enee|this)\b/g, 'энэ'],
  [/\b(?:ter|that)\b/g, 'тэр'],
  [/\b(?:bolon|ba|bas|and|also)\b/g, 'болон'],
  [/\b(?:hamt|together)\b/g, 'хамт'],
  [/\b(?:nemj|nemeh|nemelt|add)\b/g, 'нэмэх'],
  [/\b(?:deer|der)\b/g, 'дээр'],
  [/\b(?:umnu|omno|umnuh|omnoh|before)\b/g, 'өмнө'],
  [/\b(?:sain|good|best)\b/g, 'сайн'],
  [/\b(?:ner|neree|nerees|name)\b/g, 'нэр'],
]

/** Latin words customers glue together ("hedve", "bnuu", "margaashtsag"). */
function splitGlued(text: string): string {
  return text
    .replace(/\b(une|vne)(hed|heden)\b/g, '$1 $2')
    .replace(/\b(hed)(ve|we|be)\b/g, '$1 $2')
    .replace(/\b(bga|bgaa|baina|bn|bna)(uu|yu)\b/g, '$1 $2')
    .replace(/\b(margaash|unuudur|onoodor|nuguudur)(tsag\w*)\b/g, '$1 $2')
    .replace(/(\d)(tsag|cag)/g, '$1 $2')
    .replace(/(\d)\s*(?:am|a\.m\.)\b/g, '$1 am')
    .replace(/(\d)\s*(?:pm|p\.m\.)\b/g, '$1 pm')
}

/** Lower-case Cyrillic words with punctuation removed (clock times like 15:30 are kept). */
export function normText(input: string): string {
  let s = splitGlued(input.normalize('NFKC').toLowerCase().replace(/ё/g, 'е'))
  for (const [re, to] of ALIASES) s = typeof to === 'string' ? s.replace(re, to) : s.replace(re, to)
  // A gift card is not a payment card: one word, so "карт" patterns and FAQ keywords skip it.
  s = s.replace(/(?:бэлэг|бэлгийн)\s+карт[а-яөүё]*/gu, 'бэлэгкарт')
  return s
    .replace(/(\d)[:.](\d\d)\b/g, '$1#$2')
    .replace(/[+_/\\|()[\],.:;!?«»"'`~*-]+/g, ' ')
    .replace(/#/g, ':')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The text as typed plus its normalized form, so patterns may match either. */
export function probeOf(input: string): string {
  const lower = input.normalize('NFKC').toLowerCase()
  const normalized = normText(input)
  return normalized === lower ? lower : `${lower}\n${normalized}`
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** One rough Latin spelling for Cyrillic and Latin input ("Мөнхзул" and "munkhzul" meet). */
export function phonetic(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('')
    .replace(/kh/g, 'h')
    .replace(/ts|ch/g, 'c')
    .replace(/sh/g, 's')
    .replace(/w/g, 'v')
    .replace(/yu/g, 'u')
    .replace(/ya/g, 'a')
    .replace(/yo/g, 'o')
    .replace(/ii|iy|yi/g, 'i')
    .replace(/([aeiou])\1+/g, '$1')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Phonetic tokens of the original text, at least two letters long. */
export function phoneticTokens(input: string): string[] {
  return phonetic(input)
    .split(' ')
    .filter((w) => w.length >= 2)
}

function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * Whether a typed token is the vocabulary token: equal, one typo apart (5+ letters), or the
 * vocabulary word plus a Mongolian case ending ("педикюрын" for "педикюр").
 */
export function tokenMatches(typed: string, word: string): boolean {
  if (typed === word || oneEditApart(typed, word)) return true
  return word.length >= 4 && typed.length > word.length && typed.length - word.length <= 4 && typed.startsWith(word)
}

/** True when every token of `phrase` appears in `tokens` (typo-tolerant). */
export function containsPhrase(tokens: string[], phrase: string[]): boolean {
  return phrase.every((w) => tokens.some((t) => tokenMatches(t, w)))
}

/** Words that never identify a service, specialist or FAQ on their own. */
export const FUNCTION_WORDS = new Set(
  [
    'үнэ', 'хэд', 'хэдэн', 'вэ', 'бэ', 'юу', 'уу', 'үү', 'байна', 'байгаа', 'байдаг', 'болох', 'болно', 'энэ',
    'тэр', 'нь', 'миний', 'танай', 'манай', 'цаг', 'цагт', 'өдөр', 'захиалах', 'захиалга', 'авах', 'хийлгэх',
    'хийх', 'хийдэг', 'ямар', 'хэн', 'хаана', 'хэзээ', 'яаж', 'за', 'тийм', 'үгүй', 'болон', 'хамт', 'дээр',
    'бол', 'гэж', 'гэсэн', 'юм', 'мөн', 'их', 'маш', 'сайн', 'please', 'the', 'a', 'an', 'is', 'do', 'you',
    'what', 'how', 'much', 'for', 'to', 'of', 'in', 'on', 'at', 'it', 'can', 'i', 'me', 'want', 'would', 'like',
  ].map(phonetic),
)

/** Content tokens for FAQ matching: phonetic, without function words. */
export function contentTokens(input: string): string[] {
  return [...new Set(phoneticTokens(normText(input)).filter((w) => !FUNCTION_WORDS.has(w)))]
}
