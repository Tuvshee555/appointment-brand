// What the customer is asking, read only from their current message (the Lorentz lesson: never
// read intent from catalogue names or the assistant's own previous reply). Patterns are written
// once in Cyrillic and English and run against probeOf(text), so Latin spellings match too.
// Business-agnostic for appointment businesses; the catalogue is matched elsewhere.

export type Intent =
  | 'book'
  | 'reschedule'
  | 'cancel'
  | 'status'
  | 'human'
  | 'complaint'
  | 'payment_claim'
  | 'greeting'
  | 'thanks'
  | 'bye'
  | 'identity'
  | 'privacy'

export type Topic =
  | 'price'
  | 'duration'
  | 'services'
  | 'staff'
  | 'hours'
  | 'location'
  | 'cancel_policy'
  | 'deposit'
  | 'payment'
  | 'preparation'
  | 'aftercare'
  | 'parking'
  | 'contact'
  | 'availability'

export interface Detection {
  intents: Intent[]
  topics: Topic[]
  /** Phrased as a question (question particle, question word or "?"). */
  question: boolean
  /** Asks to add another service ("бас", "нэмж", "хамт"). */
  adds: boolean
}

const HUMAN =
  /(?:хүнтэй\s*(?:ярь|ярих|холбо|холбогдох)|хүн\s*(?:холбо|ярь|ярих|хэрэгтэй|байгаа\s*юу|байна\s*уу|алга|байхгүй)|ажилтан(?:тай)?\s*(?:холбо|ярь|ярих|хэрэгтэй)|ажилтантай|оператор|менежер(?:тэй)?\s*(?:холбо|ярь)|жинхэнэ\s+хүн|(?:чатбот|робот|бот)\s+биш|\bhuman\b|real\s+person|talk\s+to\s+(?:a\s+)?(?:person|human|someone|staff|manager)|speak\s+(?:to|with)\s+(?:a\s+)?(?:person|human|someone|staff)|live\s+agent|operator)/u
const COMPLAINT =
  /(?:гомдол|сэтгэл\s+дундуур|муу\s+(?:хийсэн|хийчихсэн|үйлчил)|(?:хугарсан|ховхорсон|ховхорчихлоо|унасан|шуурхай\s+биш).{0,40}(?:танай|хийлгэсэн|хийсэн)|(?:танай|хийлгэсэн|хийсэн).{0,40}(?:хугарсан|хугарчихлаа|ховхор|унасан)|complain|unhappy|disappointed|terrible\s+(?:service|job)|refund)/u
const PAYMENT_CLAIM =
  /(?:төлсөн|төлчихлөө|төлчихсөн|шилжүүлсэн|шилжүүлчихлээ|i\s+(?:have\s+)?(?:already\s+)?paid|payment\s+(?:sent|done|made))/u
const HOW = /(?:яаж|хэрхэн|how|болох\s+уу)/u
const CANCEL = /(?:цуцл|цуцал|болиулах|cancel)/u
const POLICY_QUESTION =
  /(?:бол\s+(?:яах|яадаг|юу\s+болох)|нөхцөл|бодлого|дүрэм|буцаах\s+уу|буцаадаг|буцаах\s+юм|буцаагдах|policy|what\s+if|if\s+i\s+cancel|refund)/u
const RESCHEDULE =
  /(?:өөрчл|өөрчил|солих|солиул|сольж|хойшлуул|урагшлуул|шилжүүлэх|шилжүүлмээр|reschedul|change\s+(?:my|the)\s+(?:time|appointment|booking|date)|move\s+(?:my|the)\s+(?:appointment|booking)|another\s+(?:time|day))/u
const STATUS =
  /(?:миний\s+захиалга|захиалга(?:а|аа)?\s+(?:хэзээ|хэдэн|ямар|шалга|харах|байгаа)|захиалсан\s+цаг|захиалгын\s+(?:төлөв|мэдээлэл)|цагаа\s+(?:мартчих|мартсан|шалга)|my\s+(?:booking|appointment)|when\s+is\s+my|check\s+my\s+(?:booking|appointment))/u
const BOOK =
  /(?:цаг\s*(?:авах|захиал|товл)|захиалах|захиалъя|хийлгэх|хийлгэе|хийлгэмээр|хийлгэж\s+болох|бүртгүүл|товлох|book|appointment|reserve|schedule|i\s+(?:want|would\s+like|need)\s+(?:a|an|to\s+(?:get|book|do)))/u
const GREETING =
  /^(?:сайн\s*(?:байна\s*уу|уу|байцгаана\s*уу)|мэнд(?:\s*хүргэе)?|hi+|hello|hey|good\s+(?:morning|afternoon|evening)|өглөөний\s+мэнд|оройн\s+мэнд)(?:\s*[!.,]*\s*)$/u
const THANKS = /(?:баярлалаа|баярлаа|гоё\s+байна|thanks|thank\s+you|thx|рахмат)/u
const BYE = /^(?:баяртай|bye|goodbye|see\s+you|сайхан\s+амраарай)/u
const IDENTITY =
  /(?:(?:чи|та)\s+(?:хэн\s+(?:бэ|вэ)|робот|бот|хүн\s+(?:үү|уу)|ai)|робот\s+(?:уу|үү)|бот\s+(?:уу|үү)|are\s+you\s+(?:a\s+)?(?:bot|robot|human|real|ai)|who\s+are\s+you)/u
const PRIVACY =
  /(?:(?:бусад|өөр)\s+(?:хүн|хүмүүс|үйлчлүүлэгч|хэрэглэгч)\S*.{0,40}(?:утас|дугаар|мэдээлэл|нэр|хаяг)|other\s+(?:customers?|clients?|people)\S*.{0,30}(?:phone|number|info|name|address)|(?:хэдэн\s+настай|нас\s+хэд|гэр\s+бүлтэй|хаана\s+амьдардаг|how\s+old\s+is|is\s+she\s+married))/u

const TOPICS: [Topic, RegExp][] = [
  [
    'duration',
    /(?:хэр\s*удаан|хугацаа|үргэлжл|(?:хэд(?:эн)?|\d+)\s*(?:цаг(?!т(?:\s|$))|минут)[а-яөүё]*\s*(?:орох|ордог|үргэлж|болох|зарцуул|шаард|вэ|бэ)|хэдэн\s+минут|how\s+long|duration)/u,
  ],
  [
    'price',
    /(?:үнэ|хэд\s*(?:вэ|бэ|болох|болж|болдог|вэ)?(?!\s*(?:цаг|минут|хоног|өдөр|хугацаа|настай))(?:\s|$)|хэдээр|хэдэн\s*төгрөг|төгрөг|₮|how\s+much|хямд|хямдрал|discount)/u,
  ],
  [
    'services',
    /(?:ямар\s+(?:үйлчилгээ|юу)|үйлчилгээ(?:нүүд|ний\s+жагсаалт)|юу\s+(?:хийдэг|хийх\s+вэ)|жагсаалт|menu|what\s+(?:services|do\s+you\s+(?:do|offer|have))|services\s+list)/u,
  ],
  [
    'staff',
    /(?:мастер|мэргэжилтэн|хэн\s+(?:хийдэг|хийх|хийнэ|бэ|вэ)|ажилчид|ажилтнууд|staff|specialist|technician|who\s+(?:does|can|is|will))/u,
  ],
  [
    'hours',
    /(?:ажлын\s*цаг|хэдэн\s*цаг(?:аас|т)\s*(?:онгой|нээ|ажилл|хаа)|хэдэн\s*цаг\s*хүртэл|онгойдог|хаадаг|амардаг|нээлттэй|ажилладаг\s+(?:уу|вэ|бэ)|гараг\S*\s+ажилладаг|өдөр\S*\s+ажилладаг|opening\s+hours|working\s+hours|are\s+you\s+open|open\s+on|what\s+time\s+do\s+you\s+(?:open|close))/u,
  ],
  ['location', /(?:хаяг|байршил|хаана\s+(?:байдаг|байрладаг|байна|вэ|бэ)|яаж\s+(?:оч|ирэх)|address|where\s+are\s+you|location|directions?)/u],
  ['deposit', /(?:урьдчилгаа|deposit|prepay)/u],
  ['payment', /(?:(?<!бэлэг)(?<!бэлэг\s)(?<!бэлгийн\s)карт|бэлэн\s*(?:мөнгө|ээр)?|qpay|төлбөр\s*(?:яаж|хэрхэн|ямар)|яаж\s+төл|төлөх\s+(?:вэ|уу)|данс|card|cash|how\s+(?:can|do)\s+i\s+pay|payment\s+method)/u],
  ['preparation', /(?:өмнө\s+(?:юу|яах|яаж)|бэлтгэ|юу\s+авчрах|ирэхээсээ\s+өмнө|before\s+(?:my|the)\s+(?:appointment|visit)|prepare|preparation)/u],
  ['aftercare', /(?:дараа\s+(?:яаж|юу)\s+(?:хийх|арчлах)|арчилгаа\s+(?:яаж|хэрхэн)|удаан\s+тогт|хэр\s+удаан\s+тогт|aftercare|how\s+long\s+(?:does\s+it|will\s+it)\s+last)/u],
  ['parking', /(?:зогсоол|машин\s+тавих|parking)/u],
  ['contact', /(?:утасны\s+дугаар|утас\s+(?:хэд|юу)|холбоо\s+барих|contact|phone\s+number|e-?mail|и-?мэйл)/u],
  ['availability', /(?:сул\s*(?:цаг|байна|байгаа|уу|юу)|цаг\s*(?:байна\s*уу|байгаа\s*юу|бий\s*юу|гарах|олдох)|боломжтой\s*(?:юу|уу)|available|free\s+(?:slot|time)|any\s+(?:slots?|time|openings?))/u],
]

const QUESTION =
  /(?:[?？]|(?:^|\s)(?:уу|үү|вэ|бэ|юу|юм\s+бэ|билээ|бил\s*ээ)(?:\s|$)|^(?:how|what|when|where|who|which|can|do|does|is|are)\b|(?:^|\s)(?:хэд|хэдэн|ямар|хэн|хаана|хэзээ|яаж)(?:\s|$))/u

export function detect(probe: string): Detection {
  const intents: Intent[] = []
  const topics = TOPICS.filter(([, re]) => re.test(probe)).map(([topic]) => topic)
  const question = QUESTION.test(probe)
  const has = (re: RegExp) => re.test(probe)

  if (has(HUMAN)) intents.push('human')
  if (has(COMPLAINT)) intents.push('complaint')
  if (has(PAYMENT_CLAIM) && !has(HOW)) intents.push('payment_claim')
  if (has(CANCEL)) {
    // "what happens if I cancel?" asks about the policy; "цуцлаад өгөөч" asks to do it.
    if (has(POLICY_QUESTION)) topics.push('cancel_policy')
    else intents.push('cancel')
  }
  if (has(RESCHEDULE) && !intents.includes('payment_claim')) intents.push('reschedule')
  if (has(STATUS) && !intents.includes('cancel') && !intents.includes('reschedule')) intents.push('status')
  if (has(BOOK)) intents.push('book')
  if (has(IDENTITY)) intents.push('identity')
  if (has(PRIVACY)) intents.push('privacy')
  const firstLine = probe.split('\n').at(-1) ?? probe
  if (GREETING.test(firstLine.trim()) || GREETING.test(probe.split('\n')[0].trim())) intents.push('greeting')
  if (has(THANKS)) intents.push('thanks')
  if (has(BYE)) intents.push('bye')
  return {
    intents,
    topics: [...new Set(topics)],
    question,
    adds: /(?:(?:^|\s)(?:бас|нэмж|нэмэх|нэмээд|хамт|мөн)(?:\s|$)|\balso\b|\badd\b|\bplus\b)/u.test(probe),
  }
}
