import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from 'cn'

// Shows the SSO avatar when present; Base UI keeps the initial visible until the
// image loads and restores it if loading fails.
export function UserAvatar({
  nickname,
  avatarUrl,
  className,
  fallbackClassName,
}: {
  nickname: string
  avatarUrl?: string
  className?: string
  fallbackClassName?: string
}) {
  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback className={cn(fallbackClassName)}>{Array.from(nickname)[0]}</AvatarFallback>
    </Avatar>
  )
}
