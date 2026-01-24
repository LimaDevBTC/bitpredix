'use client'

import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export interface PriceDataPoint {
  time: number // Segundos desde o início da rodada
  up: number // Preço UP em porcentagem (0-100)
  down: number // Preço DOWN em porcentagem (0-100)
}

interface PriceChartProps {
  data: PriceDataPoint[]
  roundStartAt: number
  roundEndsAt: number
}

// Componente de bolinha pulsante para o último ponto
const PulsingDot = ({ cx, cy, fill, isLast }: { cx?: number; cy?: number; fill?: string; isLast?: boolean }) => {
  if (cx === undefined || cy === undefined || !isLast) return null
  
  return (
    <g>
      {/* Círculo externo pulsante (animação) - múltiplas camadas para efeito suave */}
      <circle
        cx={cx}
        cy={cy}
        r={8}
        fill={fill}
        style={{
          animation: 'pulseDot 2s ease-in-out infinite',
        }}
      />
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill={fill}
        style={{
          animation: 'pulseDot 2s ease-in-out infinite 0.4s',
        }}
      />
      {/* Círculo médio fixo */}
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={fill}
        opacity={0.7}
      />
      {/* Círculo interno sólido */}
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill={fill}
      />
    </g>
  )
}

const formatChartTime = (value: number) => `${value}s`
const formatChartPercent = (value: number) => `${value.toFixed(1)}%`

function ChartTooltip({ active, payload }: { active?: boolean; payload?: unknown }) {
  const p = Array.isArray(payload) ? payload as Array<{ name: string; value: number; color: string; payload?: { time?: number } }> : []
  if (!active || !p.length) return null
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="text-xs text-zinc-400 mb-2">
        {p[0]?.payload?.time !== undefined ? formatChartTime(p[0].payload.time) : ''}
      </p>
      {p.map((entry, index) => (
        <p key={index} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {formatChartPercent(entry.value)}
        </p>
      ))}
    </div>
  )
}

export function PriceChart({ data, roundStartAt, roundEndsAt }: PriceChartProps) {
  const [currentTime, setCurrentTime] = useState(0)
  
  // Calcula o tempo máximo (duração da rodada em segundos)
  const maxTime = Math.floor((roundEndsAt - roundStartAt) / 1000)
  
  // Atualiza o tempo atual a cada 100ms para movimento suave
  useEffect(() => {
    const updateTime = () => {
      const now = Date.now()
      const elapsed = Math.max(0, Math.min((now - roundStartAt) / 1000, maxTime))
      setCurrentTime(elapsed)
    }
    
    updateTime()
    const interval = setInterval(updateTime, 100) // Atualiza a cada 100ms para movimento fluido
    
    return () => clearInterval(interval)
  }, [roundStartAt, maxTime])
  
  // Interpola os dados para criar movimento suave
  const chartData = useMemo(() => {
    const baseData = data.length > 0 ? data : [{ time: 0, up: 50, down: 50 }]
    
    // Se não há dados suficientes, retorna os dados base
    if (baseData.length < 1) {
      return baseData
    }
    
    // Se estamos antes do primeiro ponto, retorna apenas o primeiro ponto
    if (currentTime <= baseData[0].time) {
      return baseData
    }
    
    // Encontra o último ponto real que já passou
    let lastRealPoint = baseData[0]
    let nextRealPoint: PriceDataPoint | null = null
    
    for (let i = 0; i < baseData.length; i++) {
      if (baseData[i].time <= currentTime) {
        lastRealPoint = baseData[i]
      } else {
        nextRealPoint = baseData[i]
        break
      }
    }
    
    // Se não há próximo ponto, estende o último preço real até o tempo atual
    // Isso mantém a linha se movendo suavemente sem voltar para 50/50
    if (!nextRealPoint) {
      // Estende o último preço até o tempo atual (mantém o preço estável, linha continua se movendo)
      // Isso cria fluidez contínua mesmo quando não há novos dados
      const extendedPoint: PriceDataPoint = {
        time: currentTime,
        up: lastRealPoint.up,
        down: lastRealPoint.down,
      }
      
      const pointsUpToLast = baseData.filter((p) => p.time <= lastRealPoint.time)
      return [...pointsUpToLast, extendedPoint]
    }
    
    // Interpola linearmente entre o último ponto real e o próximo
    // Isso cria movimento suave entre pontos reais
    const timeDiff = nextRealPoint.time - lastRealPoint.time
    const currentDiff = currentTime - lastRealPoint.time
    
    // Se o gap entre pontos é muito grande (>10s), não interpola - estende último ponto
    if (timeDiff > 10) {
      const extendedPoint: PriceDataPoint = {
        time: currentTime,
        up: lastRealPoint.up,
        down: lastRealPoint.down,
      }
      const pointsUpToLast = baseData.filter((p) => p.time <= lastRealPoint.time)
      return [...pointsUpToLast, extendedPoint]
    }
    
    // Interpola suavemente entre os dois pontos reais
    const ratio = timeDiff > 0 ? Math.min(currentDiff / timeDiff, 1) : 0
    
    const interpolatedUp = lastRealPoint.up + (nextRealPoint.up - lastRealPoint.up) * ratio
    const interpolatedDown = lastRealPoint.down + (nextRealPoint.down - lastRealPoint.down) * ratio
    
    // Cria o ponto interpolado
    const interpolatedPoint: PriceDataPoint = {
      time: currentTime,
      up: interpolatedUp,
      down: interpolatedDown,
    }
    
    // Retorna todos os pontos reais até o último + o ponto interpolado
    const pointsUpToLast = baseData.filter((p) => p.time <= lastRealPoint.time)
    return [...pointsUpToLast, interpolatedPoint]
  }, [data, currentTime])
  
  // Função para renderizar dot customizado (bolinha pulsante apenas no último ponto)
  const renderPulsingDot = (props: any, color: string) => {
    const { cx, cy, payload, index } = props
    const isLast = index === chartData.length - 1
    return <PulsingDot cx={cx} cy={cy} fill={color} isLast={isLast} />
  }
  
  return (
    <div className="w-full h-64 sm:h-80 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="time"
            type="number"
            domain={[0, maxTime]}
            tickFormatter={formatChartTime}
            stroke="#71717a"
            style={{ fontSize: '11px' }}
            tick={{ fill: '#71717a' }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={formatChartPercent}
            stroke="#71717a"
            style={{ fontSize: '11px' }}
            tick={{ fill: '#71717a' }}
          />
          <Tooltip content={ChartTooltip} />
          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
            iconType="line"
            formatter={(value) => (
              <span style={{ color: value === 'UP' ? '#22C55E' : '#EF4444', fontSize: '12px' }}>
                {value}
              </span>
            )}
          />
          <Line
            type="monotone"
            dataKey="up"
            name="UP"
            stroke="#22C55E"
            strokeWidth={2}
            dot={(props) => renderPulsingDot(props, '#22C55E')}
            activeDot={{ r: 4, fill: '#22C55E' }}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="down"
            name="DOWN"
            stroke="#EF4444"
            strokeWidth={2}
            dot={(props) => renderPulsingDot(props, '#EF4444')}
            activeDot={{ r: 4, fill: '#EF4444' }}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
