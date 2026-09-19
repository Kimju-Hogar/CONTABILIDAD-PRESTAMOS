import PDFDocument from 'pdfkit';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import { TZ } from '../../shared/utils/fechas';

// ─── Formato ──────────────────────────────────────────────────
/** Moneda sin depender de Intl: PDFKit sólo digiere Latin-1 con la fuente base. */
function cop(valor: number): string {
  const n = Math.round(valor);
  const signo = n < 0 ? '-' : '';
  const miles = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${signo}$ ${miles}`;
}

function pct(valor: number): string {
  return `${valor.toFixed(2).replace('.', ',')}%`;
}

/** 'YYYY-MM-DD' o 'YYYY-MM' a algo legible en la tabla. */
function etiquetaClave(clave: string): string {
  if (clave.length === 7) {
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const [anio, mes] = clave.split('-');
    return `${meses[Number(mes) - 1]} ${anio}`;
  }
  const [anio, mes, dia] = clave.split('-');
  return `${dia}/${mes}/${anio}`;
}

// ─── Paleta ───────────────────────────────────────────────────
const TINTA = '#0f172a';
const SUAVE = '#64748b';
const MARCA = '#4f46e5';
const VERDE = '#059669';
const ROJO = '#dc2626';
const LINEA = '#e2e8f0';
const FONDO = '#f1f5f9';

const MARGEN = 40;
const ANCHO = 595.28 - MARGEN * 2;

type Doc = PDFKit.PDFDocument;

interface Columna {
  titulo: string;
  ancho: number;
  alinear?: 'left' | 'right';
}

export interface DatosReporte {
  resumen: Record<string, any>;
  porDia: Array<Record<string, number | string>>;
  porMes: Array<Record<string, number | string>>;
  cobradores: Array<Record<string, any>>;
  aging: Array<{ rango: string; monto: number; cuotas: number }>;
  generadoEn: Date;
}

// ─── Bloques de dibujo ────────────────────────────────────────
function titulo(doc: Doc, texto: string) {
  asegurarEspacio(doc, 46);
  doc.moveDown(0.6);
  doc.fillColor(MARCA).fontSize(12).font('Helvetica-Bold').text(texto.toUpperCase(), MARGEN);
  const y = doc.y + 3;
  doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO, y).strokeColor(MARCA).lineWidth(1.2).stroke();
  doc.moveDown(0.6);
}

/** Fila etiqueta/valor a lo ancho de la página. */
function fila(doc: Doc, etiqueta: string, valor: string, opciones: { fuerte?: boolean; color?: string } = {}) {
  asegurarEspacio(doc, 20);
  const y = doc.y;
  const fuente = opciones.fuerte ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(fuente).fontSize(opciones.fuerte ? 10.5 : 10);
  doc.fillColor(opciones.fuerte ? TINTA : SUAVE).text(etiqueta, MARGEN, y, { width: ANCHO * 0.62 });
  doc.fillColor(opciones.color ?? TINTA).font(fuente)
    .text(valor, MARGEN + ANCHO * 0.62, y, { width: ANCHO * 0.38, align: 'right' });
  doc.y = y + (opciones.fuerte ? 16 : 14);
}

function separador(doc: Doc) {
  const y = doc.y + 2;
  doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO, y).strokeColor(LINEA).lineWidth(0.8).stroke();
  doc.y = y + 6;
}

/** Salta de página si no caben `alto` puntos antes del pie. */
function asegurarEspacio(doc: Doc, alto: number) {
  if (doc.y + alto > 780) doc.addPage();
}

function tabla(doc: Doc, columnas: Columna[], filas: string[][]) {
  const dibujarCabecera = () => {
    const y = doc.y;
    doc.rect(MARGEN, y - 2, ANCHO, 18).fill(FONDO);
    let x = MARGEN + 4;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(8.5);
    for (const c of columnas) {
      doc.text(c.titulo, x, y + 3, { width: c.ancho - 8, align: c.alinear ?? 'left' });
      x += c.ancho;
    }
    doc.y = y + 20;
  };

  asegurarEspacio(doc, 60);
  dibujarCabecera();

  doc.font('Helvetica').fontSize(8.5);
  for (const f of filas) {
    if (doc.y + 16 > 780) {
      doc.addPage();
      dibujarCabecera();
      doc.font('Helvetica').fontSize(8.5);
    }
    const y = doc.y;
    let x = MARGEN + 4;
    for (let i = 0; i < columnas.length; i++) {
      const c = columnas[i]!;
      doc.fillColor(TINTA).text(f[i] ?? '', x, y, { width: c.ancho - 8, align: c.alinear ?? 'left' });
      x += c.ancho;
    }
    doc.y = y + 13;
    doc.moveTo(MARGEN, doc.y - 3).lineTo(MARGEN + ANCHO, doc.y - 3)
      .strokeColor(LINEA).lineWidth(0.4).stroke();
  }
  doc.moveDown(0.4);
}

// ─── Documento ────────────────────────────────────────────────
/**
 * Arma el reporte en PDF y lo devuelve como Buffer.
 * `detallado` agrega las tablas día a día; sin él sólo van los totales y el mes.
 */
export function construirReportePDF(datos: DatosReporte, detallado: boolean): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (t: Buffer) => trozos.push(t));

  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);
  });

  const r = datos.resumen;
  const generado = format(toZonedTime(datos.generadoEn, TZ), "dd/MM/yyyy 'a las' HH:mm");

  // ─── Portada ────────────────────────────────────────────────
  doc.rect(0, 0, 595.28, 92).fill(MARCA);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('GotaGota', MARGEN, 26);
  doc.font('Helvetica').fontSize(11)
    .text(detallado ? 'Reporte detallado' : 'Reporte general', MARGEN, 52);
  doc.fontSize(9).text(r.periodo.etiqueta, MARGEN, 68);
  doc.fontSize(8).fillColor('#e0e7ff')
    .text(`Generado el ${generado}`, MARGEN, 68, { width: ANCHO, align: 'right' });

  doc.fillColor(TINTA);
  doc.y = 116;

  // ─── Lo esencial ────────────────────────────────────────────
  titulo(doc, 'Resumen del periodo');
  fila(doc, 'Dinero prestado', cop(r.colocacion.capitalPrestado));
  fila(doc, `Préstamos entregados`, `${r.colocacion.cantidad}`);
  fila(doc, 'Efectivo desembolsado', cop(r.colocacion.desembolsadoEfectivo));
  fila(doc, 'Ticket promedio', cop(r.colocacion.ticketPromedio));
  separador(doc);
  fila(doc, 'Dinero recogido', cop(r.recaudo.total));
  fila(doc, `Cobros registrados`, `${r.recaudo.cantidad}`);
  fila(doc, 'Promedio diario recogido', cop(r.recaudo.promedioDiario));
  fila(doc, 'Capital recuperado', cop(r.recaudo.capitalRecuperado));

  // ─── Reparto de la ganancia ─────────────────────────────────
  titulo(doc, 'Ganancia');
  fila(doc, 'Interés ganado (parte de intereses en lo recogido)', cop(r.ingresos.interesDevengado), { color: VERDE });
  fila(doc, 'Renovación de cartones', cop(r.ingresos.cartones), { color: VERDE });
  if (r.ingresos.otros > 0) fila(doc, 'Otros ingresos', cop(r.ingresos.otros), { color: VERDE });
  fila(doc, 'Gastos del periodo', cop(-r.egresos.total), { color: ROJO });
  separador(doc);
  fila(doc, 'GANANCIA DEL NEGOCIO', cop(r.utilidad.negocio), { fuerte: true, color: VERDE });
  fila(doc, 'GANANCIA DEL COBRADOR (papelería)', cop(r.utilidad.cobrador), { fuerte: true, color: MARCA });
  fila(doc, 'TOTAL GENERADO', cop(r.utilidad.total), { fuerte: true });
  separador(doc);
  fila(doc, 'Margen sobre lo recogido', pct(r.utilidad.margenSobreRecaudo));
  fila(doc, 'Margen sobre lo prestado', pct(r.utilidad.margenSobreColocado));
  fila(doc, 'Rendimiento de la cartera', pct(r.utilidad.rentabilidadCartera));

  // ─── Cuenta de papelería y cartones ─────────────────────────
  titulo(doc, 'Cuenta de papelería y cartones');
  const cp = r.cuentaPapeleria;
  fila(doc, 'Papelería generada (histórico)', cop(cp.papeleria.generada));
  fila(doc, 'Papelería retirada', cop(-cp.papeleria.retirada), { color: ROJO });
  fila(doc, 'Cartones generados (histórico)', cop(cp.cartones.generados));
  fila(doc, 'Cartones retirados', cop(-cp.cartones.retirados), { color: ROJO });
  separador(doc);
  fila(doc, 'QUEDA DISPONIBLE EN LA CUENTA', cop(cp.total.disponible), { fuerte: true, color: VERDE });

  // ─── Cartera ────────────────────────────────────────────────
  titulo(doc, 'Cartera y mora');
  fila(doc, 'Capital en la calle', cop(r.cartera.capitalEnCalle));
  fila(doc, 'Saldo pendiente por cobrar', cop(r.cartera.saldoPendiente), { fuerte: true });
  fila(doc, 'Préstamos activos', `${r.cartera.prestamosActivos}`);
  fila(doc, 'Monto vencido', cop(r.cartera.montoVencido), { color: ROJO });
  fila(doc, 'Préstamos en mora', `${r.cartera.prestamosEnMora} de ${r.cartera.prestamosActivos}`, { color: ROJO });
  fila(doc, 'Índice de mora', pct(r.cartera.indiceMora), { fuerte: true, color: ROJO });

  if (datos.aging.length > 0) {
    doc.moveDown(0.3);
    tabla(
      doc,
      [
        { titulo: 'Antigüedad de lo vencido', ancho: 240 },
        { titulo: 'Cuotas', ancho: 100, alinear: 'right' },
        { titulo: 'Monto', ancho: ANCHO - 340, alinear: 'right' },
      ],
      datos.aging.map((a) => [a.rango, String(a.cuotas), cop(a.monto)])
    );
  }

  // ─── Caja ───────────────────────────────────────────────────
  titulo(doc, 'Cierres de caja');
  fila(doc, 'Cierres en el periodo', `${r.caja.cierres}`);
  fila(doc, 'Días con faltante', `${r.caja.faltantes}`, { color: r.caja.faltantes > 0 ? ROJO : TINTA });
  fila(doc, 'Días con sobrante', `${r.caja.sobrantes}`);
  fila(doc, 'Descuadre acumulado', cop(r.caja.diferenciaAcumulada), {
    fuerte: true,
    color: r.caja.diferenciaAcumulada === 0 ? VERDE : ROJO,
  });
  if (r.caja.ultimoCierre) {
    const uc = r.caja.ultimoCierre;
    fila(
      doc,
      `Último cierre (${uc.fechaKey})`,
      uc.estado === 'cerrado' ? `quedó con ${cop(uc.saldoContado ?? 0)}` : 'todavía abierto'
    );
  }

  // ─── Detalle por mes ────────────────────────────────────────
  if (datos.porMes.length > 0) {
    titulo(doc, 'Detalle por mes');
    tabla(
      doc,
      [
        { titulo: 'Mes', ancho: 70 },
        { titulo: 'Prestado', ancho: 82, alinear: 'right' },
        { titulo: 'Recogido', ancho: 82, alinear: 'right' },
        { titulo: 'Interés', ancho: 72, alinear: 'right' },
        { titulo: 'Papelería', ancho: 72, alinear: 'right' },
        { titulo: 'Gastos', ancho: 65, alinear: 'right' },
        { titulo: 'Ganancia', ancho: ANCHO - 443, alinear: 'right' },
      ],
      datos.porMes.map((m) => [
        etiquetaClave(String(m.clave)),
        cop(Number(m.prestado)),
        cop(Number(m.recaudado)),
        cop(Number(m.interes)),
        cop(Number(m.papeleria)),
        cop(Number(m.gastos)),
        cop(Number(m.utilidadNegocio)),
      ])
    );
  }

  // ─── Detalle por día ────────────────────────────────────────
  if (detallado && datos.porDia.length > 0) {
    titulo(doc, 'Detalle por día');
    tabla(
      doc,
      [
        { titulo: 'Fecha', ancho: 62 },
        { titulo: 'Prést.', ancho: 36, alinear: 'right' },
        { titulo: 'Prestado', ancho: 76, alinear: 'right' },
        { titulo: 'Cobros', ancho: 40, alinear: 'right' },
        { titulo: 'Recogido', ancho: 76, alinear: 'right' },
        { titulo: 'Interés', ancho: 66, alinear: 'right' },
        { titulo: 'Papelería', ancho: 66, alinear: 'right' },
        { titulo: 'Ganancia', ancho: ANCHO - 422, alinear: 'right' },
      ],
      datos.porDia.map((d) => [
        etiquetaClave(String(d.clave)),
        String(d.prestamos),
        cop(Number(d.prestado)),
        String(d.cobros),
        cop(Number(d.recaudado)),
        cop(Number(d.interes)),
        cop(Number(d.papeleria)),
        cop(Number(d.utilidadNegocio)),
      ])
    );
  }

  // ─── Cobradores ─────────────────────────────────────────────
  const conMovimiento = datos.cobradores.filter(
    (c) => c.recaudado > 0 || c.prestado > 0 || c.prestamosActivos > 0
  );
  if (conMovimiento.length > 0) {
    titulo(doc, 'Rendimiento por cobrador');
    tabla(
      doc,
      [
        { titulo: 'Cobrador', ancho: 118 },
        { titulo: 'Recogido', ancho: 82, alinear: 'right' },
        { titulo: 'Cobros', ancho: 48, alinear: 'right' },
        { titulo: 'Prestado', ancho: 82, alinear: 'right' },
        { titulo: 'Cartera', ancho: 90, alinear: 'right' },
        { titulo: 'Mora', ancho: ANCHO - 420, alinear: 'right' },
      ],
      conMovimiento.map((c) => [
        String(c.cobrador.nombre),
        cop(c.recaudado),
        String(c.cobros),
        cop(c.prestado),
        cop(c.carteraActiva),
        pct(c.indiceMora),
      ])
    );
  }

  // ─── Pie con numeración ─────────────────────────────────────
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    doc.font('Helvetica').fontSize(7.5).fillColor(SUAVE);
    doc.text(
      `GotaGota · ${r.periodo.etiqueta} · página ${i + 1} de ${paginas.count}`,
      MARGEN,
      800,
      { width: ANCHO, align: 'center' }
    );
  }

  doc.end();
  return listo;
}
