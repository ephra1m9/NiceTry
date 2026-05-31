'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Product } from '@/types'

export interface CartItem {
  product: Product
  quantity: number
  customAmount?: number
  formData?: Record<string, string>
}

interface CartContextType {
  items: CartItem[]
  addToCart: (item: Omit<CartItem, 'id'>) => void
  removeFromCart: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
  totalItems: number
  totalAmount: number
}

const CartContext = createContext<CartContextType | undefined>(undefined)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

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
  }, [])

  // Сохранение корзины в localStorage при изменении
  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(items))
  }, [items])

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
  }

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)

  const totalAmount = items.reduce((sum, item) => {
    if (item.customAmount) {
      return sum + item.customAmount
    }
    return sum + item.product.price * item.quantity
  }, 0)

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
