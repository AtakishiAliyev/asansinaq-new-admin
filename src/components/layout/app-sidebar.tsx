import { ListTree, LogOut, User } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useAuth } from '@/hooks/use-auth'
import { useSignOut } from '@/features/auth'
import { useProfile } from '@/features/profile'

// Profile is reachable from the user menu below, so it stays out of the main nav.
const NAV_ITEMS = [
  { to: '/taxonomy', label: 'Fənn və kateqoriyalar', icon: ListTree },
]

function initialsOf(name: string, email: string) {
  const source = name.trim() || email
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function AppSidebar() {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const profile = useProfile()
  const signOut = useSignOut()

  const email = session?.user.email ?? ''
  const fullName = profile.data?.full_name ?? ''

  return (
    <Sidebar>
      <SidebarHeader className="px-4 pt-4">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
          Admin paneli
        </p>
        <p className="text-lg leading-tight font-semibold tracking-tight">
          Asansinaq
        </p>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.to)}
                  >
                    <NavLink to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8">
                    <AvatarFallback>{initialsOf(fullName, email)}</AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-col">
                    {fullName ? (
                      <span className="truncate text-sm font-medium">
                        {fullName}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground truncate text-xs">
                      {email}
                    </span>
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <NavLink to="/profile">
                      <User />
                      Profil
                    </NavLink>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => signOut.mutate()}
                    disabled={signOut.isPending}
                  >
                    <LogOut />
                    Çıxış et
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
