-- Who may use the admin panel. This is configuration data, not schema, so it
-- lives here rather than in a migration: the list changes over time, and
-- migration history is not the place for a growing roster of addresses.
--
-- Seeds run on `supabase db reset` (local). They do NOT run on `db push`, so a
-- freshly created hosted project needs this statement executed once by hand —
-- otherwise nobody can get past the login screen.
insert into public.admin_emails (email, note)
values ('atas.eliyev45@gmail.com', 'owner')
on conflict (email) do nothing;

-- The starting taxonomy: the YÖS exam system and its three subjects. All of it
-- is editable through the admin panel afterwards; this only guarantees a fresh
-- environment is not empty.
insert into public.programs (name)
values ('YÖS')
on conflict do nothing;

insert into public.subjects (program_id, name, sort_order)
select p.id, s.name, s.ord
from public.programs p
join (values ('Matematik', 1), ('Geometri', 2), ('Mantık', 3)) as s (name, ord) on true
where lower(p.name) = 'yös'
on conflict do nothing;

-- The category trees. FLAT on purpose: every row is top level. The source
-- material groups these under section headers ("Bölüm 1", "Şekil ve Görsel
-- Mantık"), but those are labels for reading, not categories a question is
-- filed under — nesting them would put a level between every question and its
-- real category and buy nothing.
--
-- Without these, extraction sends the model an empty tree and the category it
-- was asked for comes back null for every question, with nothing to say why.
--
-- Subjects are resolved by NAME rather than by id. Ids differ between projects,
-- and filing twenty geometry categories under logic is not a mistake that
-- announces itself later. `on conflict do nothing` leans on
-- categories_sibling_name_key, so re-running adds only what is absent.
--
-- sort_order carries the curriculum sequence, because the sequence is the
-- content: the taxonomy page orders by sort_order then name, and at 0 these
-- would list alphabetically with "Uzay Geometri" filed between "Terazi" and
-- "Yamuk". Matematik predates this and has no stated order, so it stays at the
-- default and sorts by name.
insert into public.categories (subject_id, name, sort_order)
select s.id, c.name, c.ord
from public.subjects s
join public.programs p on p.id = s.program_id
join (values
  ('Sayılar', 0), ('Rasyonel sayılar', 0), ('Birinci dereceden denklemler', 0),
  ('Basit eşitsizlikler', 0), ('Mutlak değer', 0), ('Üslü sayılar', 0),
  ('Köklü sayılar', 0), ('Çarpanlara ayırma', 0), ('Oran-orantı', 0),
  ('Kümeler', 0), ('Fonksiyonlar', 0), ('Polinomlar', 0)
) as c (name, ord) on true
where lower(p.name) = 'yös' and s.name = 'Matematik'
on conflict do nothing;

insert into public.categories (subject_id, name, sort_order)
select s.id, c.name, c.ord
from public.subjects s
join public.programs p on p.id = s.program_id
join (values
  ('Doğruda Açılar', 1), ('Üçgende Açılar', 2), ('Özel Üçgenler', 3),
  ('Üçgende Alan', 4), ('Üçgende Açıortay', 5), ('Üçgende Kenarortay', 6),
  ('Üçgende Benzerlik', 7), ('Üçgende Açı-Kenar Bağıntıları', 8),
  ('Çokgenler', 9), ('Genel Dörtgenler', 10), ('Paralelkenar', 11),
  ('Eşkenar Dörtgen', 12), ('Dikdörtgen', 13), ('Kare', 14), ('Yamuk', 15),
  ('Çemberde Açı', 16), ('Çemberde Uzunluk', 17), ('Dairede Alan', 18),
  ('Nokta ve Doğrunun Analitik İncelenmesi', 19),
  ('Uzay Geometri ve Katı Cisimler', 20)
) as c (name, ord) on true
where lower(p.name) = 'yös' and s.name = 'Geometri'
on conflict do nothing;

insert into public.categories (subject_id, name, sort_order)
select s.id, c.name, c.ord
from public.subjects s
join public.programs p on p.id = s.program_id
join (values
  ('Şekil tamamlama ve ilişki kurma', 1),
  ('Matrisler (3x3 şekil ilişkileri)', 2),
  ('Şekil döndürme ve simetri', 3),
  ('Küplerin sayılması ve küp açılımları', 4),
  ('Çizgi, alan ve nokta grafikleri yorumlama', 5),
  ('İşlem (operatör sembolleriyle tanımlanan kurallar)', 6),
  ('Sayı dizileri ve örüntüler', 7),
  ('Tablo ve çizelge yorumlama', 8),
  ('Sütun ve daire grafikleri', 9),
  ('Şifreleme ve harf-sayı dönüşüm bulmacaları', 10),
  ('Terazi denge problemleri', 11),
  ('Blok/sıralama ve yön bulma bulmacaları', 12),
  ('Mantıksal çıkarım ve kümeler mantığı', 13)
) as c (name, ord) on true
where lower(p.name) = 'yös' and s.name = 'Mantık'
on conflict do nothing;
