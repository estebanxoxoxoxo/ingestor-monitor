import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer'
import type { BillingService, BillingSummary } from '@shared/types'
import { loadEnv } from '../env'

/**
 * Facturación de la cuenta: total del mes en curso (UTC) con desglose por
 * servicio, vía Cost Explorer. CADA consulta a esa API cuesta US$ 0,01, así
 * que el gasto automático es UNA consulta al abrir la app y nada más: el
 * resto de los refrescos son del botón, que lleva el precio a la vista.
 *
 * Si el usuario IAM de sólo lectura no tiene `ce:GetCostAndUsage`, el error
 * viaja en `error` con la política exacta que falta — la UI lo explica.
 */

let cached: BillingSummary | null = null
let started = false

export async function getBilling(refresh: boolean): Promise<BillingSummary> {
  if (cached && !refresh && !cached.error) return cached
  cached = await fetchBilling()
  return cached
}

/** La única consulta automática: al abrir la app. Idempotente. */
export function startBillingRefresh(): void {
  if (started) return
  started = true
  void getBilling(false)
}

async function fetchBilling(): Promise<BillingSummary> {
  const env = loadEnv()
  const now = new Date()
  // Del 1° del mes a HOY inclusive (End es exclusivo: se pide mañana).
  const from = `${now.toISOString().slice(0, 8)}01`
  const to = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)

  const empty: BillingSummary = {
    from,
    to: now.toISOString().slice(0, 10),
    total: null,
    currency: 'USD',
    byService: [],
    fetchedAt: null,
  }

  try {
    // Cost Explorer vive en us-east-1, sea cual sea la región de la cuenta.
    const client = new CostExplorerClient({
      region: 'us-east-1',
      ...(env.aws.accessKeyId && env.aws.secretAccessKey
        ? {
            credentials: {
              accessKeyId: env.aws.accessKeyId,
              secretAccessKey: env.aws.secretAccessKey,
            },
          }
        : {}),
    })

    const out = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: from, End: to },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }),
    )

    let total = 0
    let currency = 'USD'
    const byService: BillingService[] = []
    for (const period of out.ResultsByTime ?? []) {
      for (const group of period.Groups ?? []) {
        const metric = group.Metrics?.UnblendedCost
        const amount = Number(metric?.Amount ?? 0)
        if (metric?.Unit) currency = metric.Unit
        total += amount
        const service = group.Keys?.[0] ?? '(sin servicio)'
        const existing = byService.find((s) => s.service === service)
        if (existing) existing.amount += amount
        else byService.push({ service, amount })
      }
    }

    return {
      ...empty,
      total,
      currency,
      byService: byService.sort((a, b) => b.amount - a.amount),
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const denied = /AccessDenied|not authorized/i.test(message)
    return {
      ...empty,
      error: denied
        ? `El usuario IAM no puede consultar Cost Explorer. Hay que adjuntarle una política con la acción "ce:GetCostAndUsage" (y tener Cost Explorer habilitado en la cuenta). Detalle: ${message}`
        : message,
    }
  }
}
