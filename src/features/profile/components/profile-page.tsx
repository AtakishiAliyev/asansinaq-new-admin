import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/hooks/use-auth'
import { useSignOut } from '@/features/auth'
import { useProfile } from '@/features/profile/api/use-profile'
import { useUpdateProfile } from '@/features/profile/api/use-update-profile'
import { profileFormSchema, type ProfileFormValues } from '@/features/profile/schemas'
import { usePageTitle } from '@/hooks/use-page-title'
import { QueryErrorAlert } from '@/components/query-error-alert'

function NameForm({ defaultName }: { defaultName: string }) {
  const updateProfile = useUpdateProfile()
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { full_name: defaultName },
  })

  return (
    <form
      onSubmit={handleSubmit((values) => updateProfile.mutate(values.full_name))}
    >
      <FieldGroup>
        <Field data-invalid={errors.full_name ? true : undefined}>
          <FieldLabel htmlFor="full_name">Ad</FieldLabel>
          <Input
            id="full_name"
            autoComplete="name"
            placeholder="Ad Soyad"
            aria-invalid={errors.full_name ? true : undefined}
            {...register('full_name')}
          />
          <FieldError errors={[errors.full_name]} />
        </Field>

        <Button
          type="submit"
          className="self-start"
          disabled={updateProfile.isPending || !isDirty}
        >
          {updateProfile.isPending ? <Spinner data-icon="inline-start" /> : null}
          Yadda saxla
        </Button>
      </FieldGroup>
    </form>
  )
}

export function ProfilePage() {
  usePageTitle('Profil')
  const { session } = useAuth()
  const profile = useProfile()
  const signOut = useSignOut()
  const email = session?.user.email ?? ''

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profil</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Avatar className="size-11">
              <AvatarFallback>
                {(profile.data?.full_name.trim() || email).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate">
                {profile.data?.full_name.trim() || 'Adsız admin'}
              </CardTitle>
              <CardDescription className="truncate">{email}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {profile.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : profile.isError ? (
            <QueryErrorAlert
              error={profile.error}
              onRetry={() => profile.refetch()}
              isRetrying={profile.isFetching}
            />
          ) : (
            <NameForm
              key={profile.data.full_name}
              defaultName={profile.data.full_name}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessiya</CardTitle>
          <CardDescription>
            Çıxış etdikdən sonra yenidən giriş kodu tələb olunacaq.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
          >
            Çıxış et
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
