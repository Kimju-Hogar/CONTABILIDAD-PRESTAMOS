import PDFDocument from 'pdfkit';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import { TZ } from '../../shared/utils/fechas';

/** Moneda sin Intl: la fuente base de PDFKit sólo digiere Latin-1. */
function cop(valor: number): string {
  const n = Math.round(valor);
  const signo = n < 0 ? '-' : '';
  return `${signo}$ ${Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

const hora = (f: Date | string) => format(toZonedTime(new Date(f), TZ), 'HH:mm');

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

interface Columna { titulo: string; ancho: number; alinear?: 'left' | 'right' }

export interface DatosDia {
  fechaKey: string;
  estado: string;
  baseInicial: number;
  saldoEsperado: number;
  saldoContado: number | null;
  diferencia: number;
  clientesQuePagaron: number;
  caja?: { cobrador?: { nombre?: string }; observaciones?: string } | null;
  totales: {
    totalCobrado: number; cantidadCobros: number;
    totalPrestado: number; cantidadPrestamos: number; cargosCobrados: number;
    totalPapeleria: number; totalCartones: number;
    totalGastos: number; otrosIngresos: number; otrosEgresos: number;
  };
  cobros: Array<Record<string, any>>;
  prestamos: Array<Record<string, any>>;
  gastos: Array<Record<string, any>>;
  movimientos: Array<Record<string, any>>;
}

const ETIQUETAS_CONCEPTO: Record<string, string> = {
  inyeccion_capital: 'Inyección de capital',
  renovacion_carton: 'Renovación de cartón',
  abono_externo: 'Abono externo',
  otro_ingreso: 'Otro ingreso',
  retiro_utilidad: 'Retiro de utilidad',
  retiro_papeleria: 'Retiro de papelería',
  prestamo_externo: 'Préstamo por fuera del sistema',
  otro_egreso: 'Otro egreso',
  ajuste: 'Ajuste de caja',
};

function asegurar(doc: Doc, alto: number) {
  if (doc.y + alto > 780) doc.addPage();
}

function titulo(doc: Doc, texto: string) {
  asegurar(doc, 46);
  doc.moveDown(0.5);
  doc.fillColor(MARCA).fontSize(11.5).font('Helvetica-Bold').text(texto.toUpperCase(), MARGEN);
  const y = doc.y + 3;
  doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO, y).strokeColor(MARCA).lineWidth(1.1).stroke();
  doc.moveDown(0.5);
}

function fila(doc: Doc, etiqueta: string, valor: string, o: { fuerte?: boolean; color?: string } = {}) {
  asegurar(doc, 20);
  const y = doc.y;
  const fuente = o.fuerte ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(fuente).fontSize(o.fuerte ? 10.5 : 10);
  doc.fillColor(o.fuerte ? TINTA : SUAVE).text(etiqueta, MARGEN, y, { width: ANCHO * 0.6 });
  doc.fillColor(o.color ?? TINTA).font(fuente)
    .text(valor, MARGEN + ANCHO * 0.6, y, { width: ANCHO * 0.4, align: 'right' });
  doc.y = y + (o.fuerte ? 16 : 14);
}

function separador(doc: Doc) {
  const y = doc.y + 2;
  doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO, y).strokeColor(LINEA).lineWidth(0.8).stroke();
  doc.y = y + 6;
}

function tabla(doc: Doc, columnas: Columna[], filas: string[][]) {
  const cabecera = () => {
    const y = doc.y;
    doc.rect(MARGEN, y - 2, ANCHO, 17).fill(FONDO);
    let x = MARGEN + 4;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(8.5);
    for (const c of columnas) {
      doc.text(c.titulo, x, y + 3, { width: c.ancho - 8, align: c.alinear ?? 'left' });
      x += c.ancho;
    }
    doc.y = y + 19;
  };

  asegurar(doc, 56);
  cabecera();
  doc.font('Helvetica').fontSize(8.5);

  for (const f of filas) {
    if (doc.y + 15 > 780) { doc.addPage(); cabecera(); doc.font('Helvetica').fontSize(8.5); }
    const y = doc.y;
    let x = MARGEN + 4;
    for (let i = 0; i < columnas.length; i++) {
      const c = columnas[i]!;
      doc.fillColor(TINTA).text(f[i] ?? '', x, y, { width: c.ancho - 8, align: c.alinear ?? 'left' });
      x += c.ancho;
    }
    doc.y = y + 13;
    doc.moveTo(MARGEN, doc.y - 3).lineTo(MARGEN + ANCHO, doc.y - 3).strokeColor(LINEA).lineWidth(0.4).stroke();
  }
  doc.moveDown(0.3);
}

/** Arma el cierre del día en PDF: la plata, y de dónde salió cada peso. */
export function construirCierreDiarioPDF(d: DatosDia): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (t: Buffer) => trozos.push(t));
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);
  });

  const t = d.totales;
  const [anio, mes, dia] = d.fechaKey.split('-');
  const fechaLegible = `${dia}/${mes}/${anio}`;
  const cobrador = d.caja?.cobrador?.nombre ?? 'Sin asignar';
  const etiquetaEstado =
    d.estado === 'cerrado' ? 'CERRADA' : d.estado === 'abierto' ? 'ABIERTA' : 'SIN ABRIR';

  // ─── Encabezado ─────────────────────────────────────────────
  doc.rect(0, 0, 595.28, 88).fill(MARCA);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text('Cierre del día', MARGEN, 24);
  doc.font('Helvetica').fontSize(11).text(fechaLegible, MARGEN, 50);
  doc.fontSize(9).text(`Cobrador: ${cobrador}`, MARGEN, 67);
  doc.fontSize(9).fillColor('#e0e7ff')
    .text(`Caja ${etiquetaEstado}`, MARGEN, 50, { width: ANCHO, align: 'right' });
  doc.fillColor(TINTA);
  doc.y = 112;

  // ─── El cuadre ──────────────────────────────────────────────
  titulo(doc, 'Cuadre de caja');
  fila(doc, 'Base con la que arrancó', cop(d.baseInicial));
  fila(doc, `Cobros recibidos (${t.cantidadCobros})`, cop(t.totalCobrado), { color: VERDE });
  if (t.cargosCobrados > 0) {
    fila(doc, 'Cargos de renovación cobrados', cop(t.cargosCobrados), { color: VERDE });
  }
  if (t.otrosIngresos > 0) fila(doc, 'Otros ingresos', cop(t.otrosIngresos), { color: VERDE });
  fila(doc, `Préstamos desembolsados (${t.cantidadPrestamos})`, cop(-t.totalPrestado), { color: ROJO });
  fila(doc, 'Gastos del día', cop(-t.totalGastos), { color: ROJO });
  if (t.otrosEgresos > 0) fila(doc, 'Otros egresos y retiros', cop(-t.otrosEgresos), { color: ROJO });
  separador(doc);
  fila(doc, 'EFECTIVO QUE DEBÍA QUEDAR', cop(d.saldoEsperado), { fuerte: true });

  if (d.estado === 'cerrado') {
    fila(doc, 'Efectivo contado', cop(d.saldoContado ?? 0), { fuerte: true });
    const cuadrado = d.diferencia === 0;
    fila(
      doc,
      cuadrado ? 'DIFERENCIA' : d.diferencia < 0 ? 'FALTANTE' : 'SOBRANTE',
      cop(d.diferencia),
      { fuerte: true, color: cuadrado ? VERDE : ROJO }
    );
  } else {
    fila(doc, 'Sin contar todavía', '—', { color: SUAVE });
  }

  if (t.totalPapeleria > 0 || t.totalCartones > 0) {
    separador(doc);
    fila(doc, 'Papelería retenida hoy (del cobrador)', cop(t.totalPapeleria));
    fila(doc, 'Renovación de cartones', cop(t.totalCartones));
    doc.fontSize(8).fillColor(SUAVE)
      .text('Ya descontada del desembolso: ese efectivo está dentro del saldo de arriba.', MARGEN, doc.y, { width: ANCHO });
    doc.y += 12;
  }

  if (d.caja?.observaciones) {
    separador(doc);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(SUAVE)
      .text(d.caja.observaciones, MARGEN, doc.y, { width: ANCHO });
    doc.y += 14;
  }

  // ─── Cobros uno por uno ─────────────────────────────────────
  titulo(doc, `Cobros del día (${d.cobros.length})`);
  if (d.cobros.length === 0) {
    doc.font('Helvetica').fontSize(9.5).fillColor(SUAVE).text('No se recogió nada este día.', MARGEN);
    doc.y += 14;
  } else {
    tabla(
      doc,
      [
        { titulo: 'Hora', ancho: 44 },
        { titulo: 'Cliente', ancho: 168 },
        { titulo: 'Tipo', ancho: 62 },
        { titulo: 'Cuota', ancho: 72, alinear: 'right' },
        { titulo: 'Pagó', ancho: 78, alinear: 'right' },
        { titulo: 'Saldo después', ancho: ANCHO - 424, alinear: 'right' },
      ],
      d.cobros.map((c) => [
        c.hora ? String(c.hora).slice(0, 5) : hora(c.fecha),
        String(c.cliente?.nombre ?? 'Cliente'),
        String(c.tipo ?? ''),
        cop(Number(c.prestamo?.cuotaDiaria ?? 0)),
        cop(Number(c.monto)),
        cop(Number(c.saldoDespues ?? 0)),
      ])
    );
    fila(doc, `Total recogido · ${d.clientesQuePagaron} clientes`, cop(t.totalCobrado), { fuerte: true, color: VERDE });
  }

  // ─── Préstamos entregados ───────────────────────────────────
  if (d.prestamos.length > 0) {
    titulo(doc, `Préstamos entregados (${d.prestamos.length})`);
    tabla(
      doc,
      [
        { titulo: 'Cliente', ancho: 168 },
        { titulo: 'Capital', ancho: 84, alinear: 'right' },
        { titulo: 'Papelería', ancho: 72, alinear: 'right' },
        { titulo: 'Cartón', ancho: 62, alinear: 'right' },
        { titulo: 'Salió de caja', ancho: ANCHO - 386, alinear: 'right' },
      ],
      d.prestamos.map((p) => [
        String(p.cliente?.nombre ?? 'Cliente'),
        cop(Number(p.capital)),
        cop(Number(p.papeleria ?? 0)),
        cop(Number(p.carton ?? 0)),
        cop(Number(p.montoDesembolsado ?? 0)),
      ])
    );
    fila(doc, 'Total que salió en préstamos', cop(-t.totalPrestado), { fuerte: true, color: ROJO });
  }

  // ─── Gastos ─────────────────────────────────────────────────
  if (d.gastos.length > 0) {
    titulo(doc, `Gastos (${d.gastos.length})`);
    tabla(
      doc,
      [
        { titulo: 'Categoría', ancho: 110 },
        { titulo: 'Descripción', ancho: 290 },
        { titulo: 'Monto', ancho: ANCHO - 400, alinear: 'right' },
      ],
      d.gastos.map((g) => [
        String(g.categoria ?? ''),
        String(g.descripcion ?? ''),
        cop(Number(g.monto)),
      ])
    );
    fila(doc, 'Total gastos', cop(-t.totalGastos), { fuerte: true, color: ROJO });
  }

  // ─── Movimientos manuales ───────────────────────────────────
  if (d.movimientos.length > 0) {
    titulo(doc, `Movimientos registrados a mano (${d.movimientos.length})`);
    tabla(
      doc,
      [
        { titulo: 'Concepto', ancho: 170 },
        { titulo: 'Descripción', ancho: 210 },
        { titulo: 'Entra', ancho: 70, alinear: 'right' },
        { titulo: 'Sale', ancho: ANCHO - 450, alinear: 'right' },
      ],
      d.movimientos.map((m) => [
        ETIQUETAS_CONCEPTO[String(m.concepto)] ?? String(m.concepto),
        String(m.descripcion ?? ''),
        m.tipo === 'ingreso' ? cop(Number(m.monto)) : '',
        m.tipo === 'egreso' ? cop(Number(m.monto)) : '',
      ])
    );
  }

  // ─── Firmas ─────────────────────────────────────────────────
  asegurar(doc, 90);
  doc.moveDown(2);
  const yFirma = doc.y + 26;
  doc.moveTo(MARGEN, yFirma).lineTo(MARGEN + 210, yFirma).strokeColor(SUAVE).lineWidth(0.6).stroke();
  doc.moveTo(MARGEN + ANCHO - 210, yFirma).lineTo(MARGEN + ANCHO, yFirma).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(SUAVE);
  doc.text('Entrega (cobrador)', MARGEN, yFirma + 5, { width: 210, align: 'center' });
  doc.text('Recibe', MARGEN + ANCHO - 210, yFirma + 5, { width: 210, align: 'center' });

  // ─── Pie ────────────────────────────────────────────────────
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    doc.font('Helvetica').fontSize(7.5).fillColor(SUAVE);
    doc.text(
      `GotaGota · Cierre del ${fechaLegible} · ${cobrador} · página ${i + 1} de ${paginas.count}`,
      MARGEN, 800, { width: ANCHO, align: 'center' }
    );
  }

  doc.end();
  return listo;
}
