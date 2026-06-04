'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Product } from '@/types'

export interface CartItem {
  product: Product
  quantity: number
  customAmount?: number
  formData?: Record<string, string>
}

/** Применённый промокод. Сумма скидки считается от актуального totalAmount на стороне UI,
 *  но СЕРВЕР пересчитывает её заново при создании заказа (источник истины). */
export interface AppliedPromo {
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
}

interface CartContextType {
  items: CartItem[]
  addToCart: (item: Omit<CartItem, 'id'>) => void
  removeFromCart: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
  totalItems: number
  totalAmount: number
  /** Применённый промокод (сохраняется между корзиной и чекаутом). */
  promo: AppliedPromo | null
  applyPromo: (promo: AppliedPromo) => void
  clearPromo: () => void
  /** Сумма скидки промокода (₽) от текущего totalAmount. */
  promoDiscount: number
}

const CartContext = createContext<CartContextType | undefined>(undefined)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [promo, setPromo] = useState<AppliedPromo | null>(null)

  // Загрузка корзины из localStorage при монтировании
  useEffect(() => {
    const savedCart = localStorage.getItem('cart')
    if (savedCart) {
      try {
        setItems(JSON.parse(savedCart))
      } catch (err) {
        console.error('Failed to parse cart from localStorage:', err)
      }
    }
    const savedPromo = localStorage.getItem('cart_promo')
    if (savedPromo) {
      try {
        setPromo(JSON.parse(savedPromo))
      } catch (err) {
        console.error('Failed to parse promo from localStorage:', err)
      }
    }
  }, [])

  // Сохранение корзины в localStorage при изменении
  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(items))
  }, [items])

  // Сохранение промокода (чтобы он пережил переход корзина→чекаут).
  useEffect(() => {
    if (promo) localStorage.setItem('cart_promo', JSON.stringify(promo))
    else localStorage.removeItem('cart_promo')
  }, [promo])

  const addToCart = (item: Omit<CartItem, 'id'>) => {
    setItems((prevItems) => {
      // Проверяем, есть ли уже такой товар в корзине
      const existingIndex = prevItems.findIndex(
        (i) => i.product.id === item.product.id
      )

      if (existingIndex >= 0) {
        // Для topup товаров не объединяем, а добавляем как отдельную позицию
        if (item.product.type === 'topup_auto' || item.product.type === 'topup_manual') {
          return [...prevItems, item as CartItem]
        }

        // Для instant и manual товаров увеличиваем количество
        const newItems = [...prevItems]
        newItems[existingIndex] = {
          ...newItems[existingIndex],
          quantity: newItems[existingIndex].quantity + item.quantity,
        }
        return newItems
      }

      return [...prevItems, item as CartItem]
    })
  }

  const removeFromCart = (productId: string) => {
    setItems((prevItems) => prevItems.filter((item) => item.product.id !== productId))
  }

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId)
      return
    }

    setItems((prevItems) =>
      prevItems.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    )
  }

  const clearCart = () => {
    setItems([])
    setPromo(null)
  }

  const applyPromo = (p: AppliedPromo) => setPromo(p)
  const clearPromo = () => setPromo(null)

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)

  const totalAmount = items.reduce((sum, item) => {
    if (item.customAmount) {
      return sum + item.customAmount
    }
    return sum + item.product.price * item.quantity
  }, 0)

  // Скидка промокода от текущей суммы (для отображения). Сервер пересчитывает её при заказе.
  const promoDiscount = promo
    ? promo.discount_type === 'percent'
      ? Math.round((totalAmount * promo.discount_value) / 100)
      : Math.min(Math.round(promo.discount_value), totalAmount)
    : 0

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        totalItems,
        totalAmount,
        promo,
        applyPromo,
        clearPromo,
        promoDiscount,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
