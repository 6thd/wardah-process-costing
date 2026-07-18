/**
 * export-libs — تحميل كسول لمكتبات التصدير الثقيلة (P4-D2)
 * ==========================================================
 * xlsx (~600KB) وjspdf (~350KB) كانتا تُستوردان ثابتاً في 4 ملفات
 * فتُشحنان مع الحزمة الأولى لكل زائر — بينما لا تلزمان إلا عند ضغط
 * زر "تصدير". الآن تُحمَّلان عند أول استخدام فقط وتُكاشان تلقائياً.
 */

export type XLSXModule = typeof import('xlsx')

/** تحميل xlsx عند الحاجة */
export async function loadXLSX(): Promise<XLSXModule> {
  return await import('xlsx')
}

/** تحميل jsPDF مع jspdf-autotable مفعَّلة */
export async function loadJsPDF(): Promise<typeof import('jspdf').default> {
  const [jspdfModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'), // side-effect: يسجّل autoTable على jsPDF
  ])
  return jspdfModule.default
}

/** تحميل ApexCharts عند الحاجة (~584KB) — يُستدعى فقط حين يُرسم مكوّن رسم بياني */
export async function loadApexCharts(): Promise<typeof import('apexcharts')> {
  return (await import('apexcharts')).default as unknown as typeof import('apexcharts')
}
