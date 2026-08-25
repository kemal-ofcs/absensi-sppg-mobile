import SlipDetailClient from "./SlipDetailClient";

export function generateStaticParams() {
  return [{ id: "preview" }];
}

export default function MobileSlipDetailPage() {
  return <SlipDetailClient />;
}
