import { ContractDetailClient } from "@/components/contract-detail-client";

type ContractPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ContractPage({ params }: ContractPageProps) {
  const { id } = await params;

  return <ContractDetailClient contractId={id} />;
}
