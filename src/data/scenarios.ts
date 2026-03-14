import type { AppLocale, Scenario } from "@/types";

export const FREE_PRACTICE_SCENARIO: Scenario = {
  id: "free-practice",
  title: "Free Practice",
  title_ja: "自由練習",
  description: "Open conversation on any topic. Practice whatever you like!",
  setting: "Any setting — the conversation goes wherever you want.",
  character_role: "A friendly native Japanese speaker happy to chat about anything.",
  objectives: [
    "Practice natural conversation",
    "Explore topics you're interested in",
    "Build confidence speaking freely",
  ],
};

export const SCENARIOS: Scenario[] = [
  {
    id: "intro",
    title: "Self Introduction",
    title_ja: "自己紹介",
    description: "Introduce yourself and learn about someone new.",
    setting: "Meeting someone for the first time at a social gathering.",
    character_role: "A friendly Japanese person you've just met at a party.",
    objectives: [
      "Give your name and where you're from",
      "Talk about your hobbies or work",
      "Ask the other person about themselves",
    ],
  },
  {
    id: "convenience",
    title: "Convenience Store",
    title_ja: "コンビニ",
    description: "Buy items and handle a transaction at a konbini.",
    setting: "A typical Japanese convenience store (コンビニ).",
    character_role: "A polite convenience store clerk.",
    objectives: [
      "Ask where an item is located",
      "Handle the checkout process",
      "Respond to common clerk questions (bag, chopsticks, heating up)",
    ],
  },
  {
    id: "restaurant",
    title: "Restaurant",
    title_ja: "レストラン",
    description: "Order food, ask about the menu, and pay the bill.",
    setting: "A casual Japanese restaurant (居酒屋 or 定食屋).",
    character_role: "A friendly waiter/waitress at the restaurant.",
    objectives: [
      "Ask for a table and be seated",
      "Ask about menu items and order food",
      "Request the bill and pay",
    ],
  },
  {
    id: "weather",
    title: "Weather Chat",
    title_ja: "天気の話",
    description: "Small talk about today's weather and seasonal topics.",
    setting: "Running into a neighbor or coworker.",
    character_role: "A friendly neighbor you see regularly.",
    objectives: [
      "Comment on today's weather",
      "Discuss seasonal activities or plans",
      "Use weather-related vocabulary naturally",
    ],
  },
  {
    id: "hobbies",
    title: "Hobbies & Interests",
    title_ja: "趣味の話",
    description: "Talk about your hobbies and discover shared interests.",
    setting: "A casual café chat with a new acquaintance.",
    character_role: "A Japanese person who loves sharing hobbies.",
    objectives: [
      "Describe your hobbies in detail",
      "Ask about the other person's interests",
      "Find common ground and discuss shared activities",
    ],
  },
  {
    id: "directions",
    title: "Asking Directions",
    title_ja: "道を聞く",
    description: "Find your way around by asking for directions.",
    setting: "Lost in a Japanese city, looking for a specific place.",
    character_role: "A helpful passerby on the street.",
    objectives: [
      "Ask how to get to a specific location",
      "Understand direction words (right, left, straight)",
      "Thank the person and confirm you understand",
    ],
  },
  {
    id: "doctor",
    title: "Doctor Visit",
    title_ja: "病院",
    description: "Describe your symptoms and understand medical advice.",
    setting: "A small clinic in Japan.",
    character_role: "A patient and kind doctor.",
    objectives: [
      "Describe your symptoms clearly",
      "Answer the doctor's questions about your condition",
      "Understand the diagnosis and treatment instructions",
    ],
  },
  {
    id: "shopping",
    title: "Shopping",
    title_ja: "買い物",
    description: "Browse a store, ask about products, and make a purchase.",
    setting: "A department store or clothing shop in Japan.",
    character_role: "A helpful shop assistant.",
    objectives: [
      "Ask about sizes, colors, or availability",
      "Try on or compare items",
      "Complete the purchase",
    ],
  },
  {
    id: "hotel",
    title: "Hotel Check-in",
    title_ja: "ホテル",
    description: "Check into a hotel and handle common requests.",
    setting: "The front desk of a Japanese hotel or ryokan.",
    character_role: "A professional and polite hotel receptionist.",
    objectives: [
      "Check in with your reservation",
      "Ask about hotel amenities and services",
      "Make a special request (extra pillow, late checkout, etc.)",
    ],
  },
  {
    id: "phone",
    title: "Phone Call",
    title_ja: "電話",
    description: "Handle a phone conversation — harder without visual cues!",
    setting: "A phone call to make a reservation or inquiry.",
    character_role: "A restaurant or business staff member answering the phone.",
    objectives: [
      "Greet appropriately for a phone call",
      "State the purpose of your call clearly",
      "Confirm details and end the call politely",
    ],
  },
  {
    id: "train",
    title: "Train Station",
    title_ja: "駅で",
    description: "Navigate the train system and buy tickets.",
    setting: "A busy Japanese train station.",
    character_role: "A station attendant at the information counter.",
    objectives: [
      "Ask which train or platform to use",
      "Buy a ticket or ask about IC cards",
      "Ask about transfer information",
    ],
  },
  {
    id: "post-office",
    title: "Post Office",
    title_ja: "郵便局",
    description: "Send a package or buy stamps at the post office.",
    setting: "A Japanese post office (郵便局).",
    character_role: "A helpful post office clerk.",
    objectives: [
      "Explain what you want to send and where",
      "Choose a shipping method and understand costs",
      "Fill out forms with assistance",
    ],
  },
];

type BuiltInScenarioCopy = Pick<Scenario, "title" | "description" | "setting" | "character_role" | "objectives">;

const SCENARIO_COPY_ES: Record<string, BuiltInScenarioCopy> = {
  "free-practice": {
    title: "Practica libre",
    description: "Conversacion abierta sobre cualquier tema. Practica lo que quieras.",
    setting: "Cualquier contexto: la conversacion puede ir a donde quieras.",
    character_role: "Una persona japonesa amistosa y nativa, feliz de charlar sobre cualquier cosa.",
    objectives: [
      "Practicar conversacion natural",
      "Explorar temas que te interesan",
      "Ganar confianza hablando libremente",
    ],
  },
  intro: {
    title: "Presentacion personal",
    description: "Presentate y conoce a alguien nuevo.",
    setting: "Conoces a alguien por primera vez en una reunion social.",
    character_role: "Una persona japonesa amigable que acabas de conocer en una fiesta.",
    objectives: [
      "Decir tu nombre y de donde eres",
      "Hablar sobre tus hobbies o trabajo",
      "Preguntar a la otra persona sobre si misma",
    ],
  },
  convenience: {
    title: "Tienda de conveniencia",
    description: "Compra productos y realiza una transaccion en un konbini.",
    setting: "Una tienda de conveniencia japonesa tipica (コンビニ).",
    character_role: "Un empleado educado de una tienda de conveniencia.",
    objectives: [
      "Preguntar donde esta un articulo",
      "Completar el proceso de pago",
      "Responder a preguntas comunes del empleado (bolsa, palillos, calentar comida)",
    ],
  },
  restaurant: {
    title: "Restaurante",
    description: "Pide comida, pregunta por el menu y paga la cuenta.",
    setting: "Un restaurante japones informal (居酒屋 o 定食屋).",
    character_role: "Un mesero o mesera amable del restaurante.",
    objectives: [
      "Pedir una mesa y sentarte",
      "Preguntar por platos del menu y ordenar",
      "Pedir la cuenta y pagar",
    ],
  },
  weather: {
    title: "Charla sobre el clima",
    description: "Conversacion casual sobre el clima de hoy y temas de temporada.",
    setting: "Te encuentras con un vecino o companero de trabajo.",
    character_role: "Un vecino amable al que ves con frecuencia.",
    objectives: [
      "Comentar el clima de hoy",
      "Hablar sobre planes o actividades de temporada",
      "Usar vocabulario relacionado con el clima de forma natural",
    ],
  },
  hobbies: {
    title: "Hobbies e intereses",
    description: "Habla sobre tus hobbies y descubre intereses compartidos.",
    setting: "Una charla casual en una cafeteria con una persona que acabas de conocer.",
    character_role: "Una persona japonesa que disfruta compartir sus hobbies.",
    objectives: [
      "Describir tus hobbies con detalle",
      "Preguntar por los intereses de la otra persona",
      "Encontrar puntos en comun y hablar sobre actividades compartidas",
    ],
  },
  directions: {
    title: "Pedir direcciones",
    description: "Encuentra tu camino pidiendo indicaciones.",
    setting: "Estas perdido en una ciudad japonesa y buscas un lugar especifico.",
    character_role: "Una persona en la calle dispuesta a ayudarte.",
    objectives: [
      "Preguntar como llegar a un lugar especifico",
      "Entender palabras de direccion (derecha, izquierda, recto)",
      "Agradecer y confirmar que entendiste",
    ],
  },
  doctor: {
    title: "Visita al medico",
    description: "Describe tus sintomas y entiende consejos medicos.",
    setting: "Una pequena clinica en Japon.",
    character_role: "Un doctor paciente y amable.",
    objectives: [
      "Describir tus sintomas claramente",
      "Responder las preguntas del doctor sobre tu condicion",
      "Entender el diagnostico y las instrucciones del tratamiento",
    ],
  },
  shopping: {
    title: "Compras",
    description: "Explora una tienda, pregunta por productos y realiza una compra.",
    setting: "Una tienda departamental o de ropa en Japon.",
    character_role: "Un dependiente amable.",
    objectives: [
      "Preguntar por tallas, colores o disponibilidad",
      "Probarte o comparar articulos",
      "Completar la compra",
    ],
  },
  hotel: {
    title: "Registro en hotel",
    description: "Haz el check-in en un hotel y resuelve solicitudes comunes.",
    setting: "La recepcion de un hotel japones o ryokan.",
    character_role: "Un recepcionista profesional y educado.",
    objectives: [
      "Hacer el check-in con tu reservacion",
      "Preguntar por servicios y amenidades del hotel",
      "Hacer una solicitud especial (almohada extra, salida tarde, etc.)",
    ],
  },
  phone: {
    title: "Llamada telefonica",
    description: "Gestiona una conversacion por telefono, mas dificil sin pistas visuales.",
    setting: "Una llamada para hacer una reservacion o una consulta.",
    character_role: "Personal de un restaurante o negocio que contesta el telefono.",
    objectives: [
      "Saludar apropiadamente en una llamada",
      "Explicar claramente el motivo de la llamada",
      "Confirmar detalles y terminar la llamada con cortesia",
    ],
  },
  train: {
    title: "Estacion de tren",
    description: "Navega el sistema ferroviario y compra boletos.",
    setting: "Una estacion de tren concurrida en Japon.",
    character_role: "Un empleado de informacion de la estacion.",
    objectives: [
      "Preguntar que tren o andén debes usar",
      "Comprar un boleto o preguntar por tarjetas IC",
      "Preguntar por informacion sobre transbordos",
    ],
  },
  "post-office": {
    title: "Oficina postal",
    description: "Envía un paquete o compra estampillas en la oficina de correos.",
    setting: "Una oficina postal japonesa (郵便局).",
    character_role: "Un empleado de correos servicial.",
    objectives: [
      "Explicar qué quieres enviar y adónde",
      "Elegir un método de envío y entender los costos",
      "Llenar formularios con ayuda",
    ],
  },
};

export function localizeScenario(scenario: Scenario, locale: AppLocale): Scenario {
  if (locale !== "es") return scenario;
  if (scenario.isCustom) return scenario;
  const translated = SCENARIO_COPY_ES[scenario.id];
  if (!translated) return scenario;
  return {
    ...scenario,
    ...translated,
  };
}
