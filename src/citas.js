// CitaYa · dominio de la cita previa de la sede electrónica de Villaverde del Río.
// Módulo puro (sin E/S): lo usan igual Node (pruebas) y el navegador (public/app.js).

export const HORA_APERTURA = 9;          // 09:00
export const HORA_CIERRE = 13;           // 14:00 (la última franja empieza a las 13:45)
export const DURACION_FRANJA_MIN = 15;
export const ANTELACION_MIN_CANCELACION_H = 2;

export const OFICINAS = [
  { id: "OAC-CENTRO", nombre: "Oficina de Atención Ciudadana · Centro", ventanillas: 2 },
  { id: "OAC-NORTE", nombre: "Oficina de Atención Ciudadana · Barrio Norte", ventanillas: 1 },
  { id: "OAC-RIBERA", nombre: "Oficina de Atención Ciudadana · La Ribera", ventanillas: 1 },
];

export const TRAMITES = [
  { id: "PADRON", nombre: "Alta o cambio en el padrón" },
  { id: "CERT-PADRON", nombre: "Certificado de empadronamiento" },
  { id: "REGISTRO", nombre: "Registro general de documentos" },
  { id: "TASAS", nombre: "Pago y consulta de tasas municipales" },
];

const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";

export class ErrorCita extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = "ErrorCita";
    this.codigo = codigo;
  }
}

const dosDigitos = n => String(n).padStart(2, "0");

/** Franjas del día en formato "HH:MM" (09:00, 09:15 ... 13:45). */
export function franjasDelDia() {
  const franjas = [];
  for (let min = HORA_APERTURA * 60; min < HORA_CIERRE * 60; min += DURACION_FRANJA_MIN) {
    franjas.push(`${dosDigitos(Math.floor(min / 60))}:${dosDigitos(min % 60)}`);
  }
  return franjas;
}

/** DNI español: 8 dígitos + letra de control. Acepta minúsculas y espacios. */
export function dniValido(dni) {
  const limpio = String(dni || "").toUpperCase().replace(/\s|-/g, "");
  const m = /^(\d{8})([A-Z])$/.exec(limpio);
  if (!m) return false;
  return LETRAS_DNI[Number(m[1]) % 23] === m[2];
}

export function crearAgenda() {
  return { citas: [], secuencia: 0 };
}

/** Fecha y hora locales de una cita como objeto Date. */
export function momentoDeCita(fecha, hora) {
  return new Date(`${fecha}T${hora}:00`);
}

function esFinDeSemana(fecha) {
  const dia = momentoDeCita(fecha, "12:00").getDay();
  return dia === 0 || dia === 6;
}

function activasEnFranja(agenda, oficinaId, fecha, hora) {
  return agenda.citas.filter(c => c.estado === "activa" && c.oficinaId === oficinaId && c.fecha === fecha && c.hora === hora).length;
}

/** Huecos libres por franja para una oficina y un día. */
export function disponibilidad(agenda, oficinaId, fecha) {
  const oficina = OFICINAS.find(o => o.id === oficinaId);
  if (!oficina) throw new ErrorCita("OFICINA_DESCONOCIDA", `No existe la oficina ${oficinaId}`);
  if (esFinDeSemana(fecha)) return [];
  return franjasDelDia().map(hora => ({ hora, libres: oficina.ventanillas - activasEnFranja(agenda, oficinaId, fecha, hora) }));
}

/** Capacidad diaria de una oficina (citas posibles en un día laborable). */
export function capacidadDiaria(oficinaId) {
  const oficina = OFICINAS.find(o => o.id === oficinaId);
  if (!oficina) throw new ErrorCita("OFICINA_DESCONOCIDA", `No existe la oficina ${oficinaId}`);
  return franjasDelDia().length * oficina.ventanillas;
}

/**
 * Reserva una cita. Devuelve la cita creada (con su localizador) o lanza ErrorCita.
 * `ahora` se inyecta para poder probar sin depender del reloj.
 */
export function reservar(agenda, { oficinaId, tramiteId, fecha, hora, dni }, ahora = new Date()) {
  if (!OFICINAS.some(o => o.id === oficinaId)) throw new ErrorCita("OFICINA_DESCONOCIDA", `No existe la oficina ${oficinaId}`);
  if (!TRAMITES.some(t => t.id === tramiteId)) throw new ErrorCita("TRAMITE_DESCONOCIDO", `No existe el trámite ${tramiteId}`);
  if (!dniValido(dni)) throw new ErrorCita("DNI_INVALIDO", "El DNI no es válido (8 dígitos y letra de control)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) throw new ErrorCita("FECHA_INVALIDA", "La fecha debe tener formato AAAA-MM-DD");
  if (esFinDeSemana(fecha)) throw new ErrorCita("DIA_NO_LABORABLE", "Las oficinas no abren en fin de semana");
  if (!franjasDelDia().includes(hora)) throw new ErrorCita("FRANJA_INVALIDA", `La hora ${hora} no es una franja de atención`);
  if (momentoDeCita(fecha, hora) <= ahora) throw new ErrorCita("FECHA_PASADA", "No se puede reservar en el pasado");

  const dniNormalizado = String(dni).toUpperCase().replace(/\s|-/g, "");
  const duplicada = agenda.citas.some(c => c.estado === "activa" && c.dni === dniNormalizado && c.tramiteId === tramiteId);
  if (duplicada) throw new ErrorCita("CITA_DUPLICADA", "Ya tienes una cita activa para este trámite");

  const oficina = OFICINAS.find(o => o.id === oficinaId);
  if (activasEnFranja(agenda, oficinaId, fecha, hora) >= oficina.ventanillas) {
    throw new ErrorCita("FRANJA_COMPLETA", "No quedan huecos en esa franja");
  }

  agenda.secuencia += 1;
  const cita = {
    localizador: `VDR-${fecha.replace(/-/g, "")}-${String(agenda.secuencia).padStart(4, "0")}`,
    oficinaId, tramiteId, fecha, hora,
    dni: dniNormalizado,
    estado: "activa",
    creadaEn: ahora.toISOString(),
  };
  agenda.citas.push(cita);
  return cita;
}

/**
 * LAB 1 · Historia de usuario HU-01 "Cancelar mi cita".
 *
 * Reglas (las comprueban las pruebas de test/unit/cancelacion.test.js):
 *  1. Si el localizador no existe        → ErrorCita("CITA_NO_ENCONTRADA").
 *  2. Si la cita no está "activa"        → ErrorCita("CITA_NO_ACTIVA").
 *  3. Si faltan menos de ANTELACION_MIN_CANCELACION_H horas para la cita
 *     (comparando con `ahora`)           → ErrorCita("FUERA_DE_PLAZO").
 *     Exactamente 2 h antes SÍ se puede cancelar.
 *  4. Si todo va bien: la cita pasa a estado "cancelada", se guarda `canceladaEn`
 *     (ISO de `ahora`) y se devuelve la cita. La franja vuelve a quedar libre.
 */
export function cancelar(agenda, localizador, ahora = new Date()) {
 if(!localizador)  throw new ErrorCita("CITA_NO_ENCONTRADA", "La cita no existe(LAB 1)");
  const cita = agenda.citas.find(c => c.localizador === localizador);
   if (!cita) throw new ErrorCita("CITA_NO_ENCONTRADA", "La cita no existe(LAB 1)");
   if(cita.estado!="activa") throw new ErrorCita("CITA_NO_ACTIVA", "La cita no está activa(LAB 1)");
  const momentoCita = momentoDeCita(cita.fecha, cita.hora);
  const diferenciaMs = Math.abs(momentoCita - ahora);
  const antelacionHoresEnMs = ANTELACION_MIN_CANCELACION_H * 60 * 60 * 1000;
  if(diferenciaMs<=antelacionHoresEnMs) throw new ErrorCita("FUERA_DE_PLAZO", "La cita no se puede cancelar, fuera de plazo(LAB 1)");
  cita.estado="cancelada";
  cita.canceladaEn=ahora.toISOString();
  return cita;
}

/** Resumen para operación (historia de operaciones HO-01 del LAB 1). */
export function estadisticas(agenda) {
  const activas = agenda.citas.filter(c => c.estado === "activa").length;
  return { total: agenda.citas.length, activas };
}
