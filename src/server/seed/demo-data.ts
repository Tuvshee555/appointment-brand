// Fictional people and phrases for the demo. Names are invented; phone
// numbers use the 5000 prefix that no Mongolian operator issues, and e-mail
// addresses use the reserved `.example` domain, so none of them reaches a
// real person.

export const DEMO_CUSTOMERS: { name: string; email?: string; preferences?: string; notes?: string }[] = [
  {
    name: 'Б. Энхжин',
    email: 'enkhjin@mail.example',
    preferences: 'Богино зуйван хэлбэр, нүцгэн өнгө',
    notes: 'Байнгын үйлчлүүлэгч — 3 долоо хоног тутам ирдэг.',
  },
  { name: 'Д. Номуун', preferences: 'Бүйлс хэлбэр, урт' },
  { name: 'Э. Сарнай', email: 'sarnai@mail.example', preferences: 'Оройн цаг илүүд үздэг' },
  { name: 'Г. Уянга', preferences: 'Франц, сүүн суурь' },
  { name: 'Ц. Мишээл', notes: 'Гель будагт мэдрэг — гипоаллерген суурь ашиглах.' },
  { name: 'О. Оюунчимэг', email: 'oyuka@mail.example', preferences: 'Педикюр + гель' },
  { name: 'Н. Хонгорзул', preferences: 'Хром, мөнгөлөг дизайн' },
  { name: 'Б. Ариунаа' },
  { name: 'Ж. Цэцэгмаа', preferences: 'Тайван, чимээгүй үйлчилгээ' },
  { name: 'С. Нандин-Эрдэнэ', email: 'nandin@mail.example' },
  { name: 'Т. Гэрэлмаа', preferences: 'Богино дөрвөлжин' },
  { name: 'А. Мөнгөнцэцэг' },
  { name: 'Л. Бүжин', preferences: 'Сувдан чимэглэл' },
  { name: 'Ч. Дөлгөөн' },
  { name: 'М. Ундрал', email: 'undral@mail.example' },
  { name: 'Б. Наран', preferences: 'Бага зэрэг богино байлгах' },
  { name: 'Д. Батзаяа' },
  { name: 'Э. Хүслэн', preferences: 'Пастел өнгө' },
  { name: 'Г. Тэлмэн' },
  { name: 'П. Золзаяа', email: 'zolzaya@mail.example', preferences: 'Байгалийн хүрэн өнгө' },
  { name: 'Р. Ихбаяр', preferences: 'Эрэгтэй маникюр, матт' },
  { name: 'С. Тэмүүлэн' },
  { name: 'Х. Индра', preferences: 'Захиалгат дизайн' },
  { name: 'Ё. Анужин' },
  { name: 'Ц. Мөнхчимэг', preferences: 'Өглөөний цаг' },
  { name: 'Н. Сэлэнгэ', email: 'selenge@mail.example' },
  { name: 'О. Билгүүн' },
  { name: 'Б. Маралмаа', preferences: 'Урт сунгалт, бүйлс' },
  { name: 'Т. Цолмон' },
  { name: 'Д. Есүй', preferences: 'Франц педикюр' },
  { name: 'Э. Ганцэцэг' },
  { name: 'А. Пүрэвсүрэн', email: 'purevsuren@mail.example' },
  { name: 'Г. Хишигмаа' },
  { name: 'Ж. Нарантуяа', preferences: 'Гарын парафин' },
  { name: 'С. Энхтуяа' },
  { name: 'Б. Мөнхзаяа' },
  { name: 'Л. Оюука', preferences: 'Цайвар ягаан' },
  { name: 'Д. Сондор' },
  { name: 'М. Эрдэнэцэцэг' },
  { name: 'Ч. Ариунзул', email: 'ariunzul@mail.example', preferences: 'Хар, яст мэлхийн хээ' },
]

/** Demo phone for the n-th customer (0-based): 5000 0101 … */
export function demoPhone(index: number) {
  return String(50000101 + index)
}

export const CUSTOMER_NOTES = [
  'Богино зуйван хэлбэр хүсэж байна.',
  'Анх удаа ирж байна.',
  'Хуучин сунгалтаа авахуулна.',
  'Нүцгэн, цайвар өнгө сонгоно.',
  'Нэг хумс хугарсан.',
  'Зургаа авчирна.',
  'Хүүхэдтэйгээ ирнэ, 5 минут хоцорч магадгүй.',
  'Хром хийлгэх сонирхолтой.',
]

export const CANCEL_TEXTS = [
  'Ажил гарсан.',
  'Хотоос гарах болсон.',
  'Өвдсөн.',
  'Өөр өдөр ирнэ.',
  'Давхар захиалсан байсан.',
]

/** Sample assistant conversations shown in the admin «AI туслах» page. */
export const DEMO_CHATS: {
  channel: 'web' | 'messenger'
  messages: { role: 'user' | 'assistant'; content: string }[]
}[] = [
  {
    channel: 'web',
    messages: [
      { role: 'user', content: 'Сайн байна уу, гель будалт хэд вэ?' },
      {
        role: 'assistant',
        content:
          'Сайн байна уу. Гель будалт 65,000₮, 1 цаг 30 минут үргэлжилнэ. Хуучин гелээ авахуулах бол нэмэлт 10,000₮, 15 минут. Цаг шалгаж өгөх үү?',
      },
      { role: 'user', content: 'Маргааш оройхон боломжтой юу?' },
      {
        role: 'assistant',
        content:
          'Маргааш Номин мастерт 17:30, 18:15 цаг сул байна. Аль нь тохирох вэ? Сонгосны дараа нэр, утсаа үлдээвэл захиалгын хүсэлт илгээнэ.',
      },
    ],
  },
  {
    channel: 'web',
    messages: [
      { role: 'user', content: 'хумс сунгалт хэр удаан үргэлжилдэг вэ' },
      {
        role: 'assistant',
        content:
          'Типсээр сунгалт 2 цаг 30 минут (120,000₮), гель сунгалт 2 цаг 45 минут (140,000₮) үргэлжилнэ. Сунгалтыг Солонго, Ану мастер хийдэг. 100,000₮-өөс дээш захиалгад 20,000₮ урьдчилгаа авдаг.',
      },
    ],
  },
  {
    channel: 'messenger',
    messages: [
      { role: 'user', content: 'Хаана байрладаг вэ? Машин тавих зогсоол байгаа юу' },
      {
        role: 'assistant',
        content:
          'Бид Сүхбаатар дүүрэг, Жишээ гудамж 12-ын 2 давхарт байрладаг (демо хаяг). Зогсоолын талаарх мэдээлэл надад алга тул ажилтан тантай удахгүй холбогдоно.',
      },
    ],
  },
]
