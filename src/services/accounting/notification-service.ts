import { supabase } from '@/lib/supabase'
import { VarianceAnalysis, OverheadVariance } from './variance-monitoring-service'

/**
 * Interface for notification preferences
 */
export interface NotificationPreferences {
  userId: string
  email: boolean
  inApp: boolean
  sms: boolean
  push: boolean
  varianceThreshold: number // Minimum variance amount to notify
  severityThreshold: 'LOW' | 'MEDIUM' | 'HIGH'
}

/**
 * Interface for notification messages
 */
export interface NotificationMessage {
  id?: string
  userId: string
  title: string
  message: string
  type: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS'
  read: boolean
  createdAt: string
}

/**
 * Notification Service
 * Handles real notification capabilities for accounting events
 */
export class NotificationService {
  /**
   * Send variance alert notification
   */
  static async sendVarianceAlert(
    userId: string,
    variance: VarianceAnalysis,
    preferences: NotificationPreferences
  ): Promise<void> {
    const message = this.formatVarianceAlertMessage(variance)
    
    // Send in-app notification
    if (preferences.inApp) {
      await this.createInAppNotification(userId, {
        userId,
        title: 'Variance Alert',
        message,
        type: this.getNotificationType(variance.severity),
        read: false,
        createdAt: new Date().toISOString()
      })
    }
    
    // Send email notification (if implemented)
    if (preferences.email) {
      await this.sendEmailNotification(userId, 'Variance Alert', message)
    }
    
    // Send SMS notification (if implemented)
    if (preferences.sms) {
      await this.sendSmsNotification(userId, message)
    }
    
    // Send push notification (if implemented)
    if (preferences.push) {
      await this.sendPushNotification(userId, 'Variance Alert', message)
    }
  }

  /**
   * Send overhead variance notification
   */
  static async sendOverheadVarianceAlert(
    userId: string,
    variance: OverheadVariance,
    preferences: NotificationPreferences
  ): Promise<void> {
    const message = this.formatOverheadVarianceMessage(variance)
    
    // Send in-app notification
    if (preferences.inApp) {
      await this.createInAppNotification(userId, {
        userId,
        title: 'Overhead Variance Alert',
        message,
        type: this.getNotificationType(variance.severity),
        read: false,
        createdAt: new Date().toISOString()
      })
    }
    
    // Send email notification (if implemented)
    if (preferences.email) {
      await this.sendEmailNotification(userId, 'Overhead Variance Alert', message)
    }
  }

  /**
   * Create in-app notification
   */
  static async createInAppNotification(userId: string, notification: Omit<NotificationMessage, 'id'>): Promise<string> {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        read: notification.read,
        created_at: notification.createdAt
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    return data.id
  }

  /**
   * Get user's unread notifications
   */
  static async getUnreadNotifications(userId: string): Promise<NotificationMessage[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('read', false)
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return data as NotificationMessage[]
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)

    if (error) throw new Error(error.message)
  }

  /**
   * Mark all notifications as read
   */
  static async markAllAsRead(userId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)

    if (error) throw new Error(error.message)
  }

  /**
   * Delete notification
   */
  static async deleteNotification(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)

    if (error) throw new Error(error.message)
  }

  /**
   * Get notification preferences for a user
   */
  static async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error) {
      // Return default preferences if none exist
      return {
        userId,
        email: true,
        inApp: true,
        sms: false,
        push: false,
        varianceThreshold: 1000,
        severityThreshold: 'MEDIUM'
      }
    }
    
    return data as NotificationPreferences
  }

  /**
   * Update notification preferences for a user
   */
  static async updateNotificationPreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<void> {
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: userId,
        ...preferences
      }, {
        onConflict: 'user_id'
      })

    if (error) throw new Error(error.message)
  }

  /**
   * Format variance alert message
   */
  private static formatVarianceAlertMessage(variance: VarianceAnalysis): string {
    return `High variance detected in MO ${variance.moId} Stage ${variance.stageNo}. 
            Total variance: ${variance.totalVariance.toFixed(2)} (${variance.variancePercentage.toFixed(2)}%). 
            Severity: ${variance.severity}`
  }

  /**
   * Format overhead variance message
   */
  private static formatOverheadVarianceMessage(variance: OverheadVariance): string {
    return `Overhead variance detected for Work Center ${variance.workCenterId}. 
            Applied: ${variance.appliedOH.toFixed(2)}, Actual: ${variance.actualOH.toFixed(2)}. 
            Variance: ${variance.variance.toFixed(2)} (${variance.variancePercentage.toFixed(2)}%). 
            Severity: ${variance.severity}`
  }

  /**
   * Get notification type based on severity
   */
  private static getNotificationType(severity: string): 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' {
    switch (severity) {
      case 'HIGH':
        return 'ERROR'
      case 'MEDIUM':
        return 'WARNING'
      case 'LOW':
        return 'INFO'
      default:
        return 'INFO'
    }
  }

  /**
   * Send email notification (placeholder implementation)
   */
  private static async sendEmailNotification(userId: string, subject: string, message: string): Promise<void> {
    // In a real implementation, you would integrate with an email service
    console.log(`Email notification to user ${userId}: ${subject} - ${message}`)
    // Example integration with a service like SendGrid, Nodemailer, etc.
  }

  /**
   * Send SMS notification (placeholder implementation)
   */
  private static async sendSmsNotification(userId: string, message: string): Promise<void> {
    // In a real implementation, you would integrate with an SMS service
    console.log(`SMS notification to user ${userId}: ${message}`)
    // Example integration with a service like Twilio, AWS SNS, etc.
  }

  /**
   * Send push notification (placeholder implementation)
   */
  private static async sendPushNotification(userId: string, title: string, message: string): Promise<void> {
    // In a real implementation, you would integrate with a push notification service
    console.log(`Push notification to user ${userId}: ${title} - ${message}`)
    // Example integration with Firebase Cloud Messaging, Apple Push Notification Service, etc.
  }
}

// Export default instance for convenience
export default NotificationService