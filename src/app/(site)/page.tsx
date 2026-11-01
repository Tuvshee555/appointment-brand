import { Hero } from '@/components/home/hero'
import {
  About,
  Categories,
  DemoAdminCta,
  Differentiators,
  Experience,
  Faq,
  FeaturedServices,
  Gallery,
  Location,
  PriceList,
  StaffSection,
} from '@/components/home/sections'
import { getPublicCatalog, getPublicSalon } from '@/server/queries/public'

export default async function HomePage() {
  const [salon, catalog] = await Promise.all([getPublicSalon(), getPublicCatalog()])
  return (
    <>
      <Hero salon={salon} serviceCount={catalog.services.length} staffCount={catalog.staff.length} />
      <Differentiators />
      <FeaturedServices catalog={catalog} />
      <Categories catalog={catalog} />
      <PriceList catalog={catalog} />
      <StaffSection catalog={catalog} />
      <Gallery />
      <Experience salon={salon} />
      <About salon={salon} />
      <Faq salon={salon} catalog={catalog} />
      <Location salon={salon} />
      <DemoAdminCta />
    </>
  )
}
