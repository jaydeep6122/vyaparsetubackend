import {
  createHandoffService,
  createDirectService,
  createTruckDistService,
  createMoneyGivenService,
} from "./create.services.js";

export async function createHandoff(req, res) {
  const { factoryId } = req.params;
  const { kiln_worker_id, producer_molder_id, quantity, date, notes } = req.body;

  const result = await createHandoffService({
    factoryId,
    kilnWorkerId: kiln_worker_id,
    producerMolderId: producer_molder_id,
    quantity,
    date,
    notes,
  });

  res.status(201).json(result);
}

export async function createDirect(req, res) {
  const { factoryId } = req.params;
  const { worker_id, quantity, amount, date, notes } = req.body;

  const result = await createDirectService({
    factoryId,
    workerId: worker_id,
    quantity,
    amount,
    date,
    notes,
  });

  res.status(201).json(result);
}

export async function createTruckDistribution(req, res) {
  const { factoryId } = req.params;
  const { truck_worker_ids, total_quantity, date, notes } = req.body;

  const result = await createTruckDistService({
    factoryId,
    truckWorkerIds: truck_worker_ids,
    totalQuantity: total_quantity,
    date,
    notes,
  });

  res.status(201).json(result);
}

export async function createMoneyGiven(req, res) {
  const { factoryId } = req.params;
  const { worker_id, amount, date, notes } = req.body;

  const result = await createMoneyGivenService({
    factoryId,
    workerId: worker_id,
    amount,
    date,
    notes,
  });

  res.status(201).json(result);
}
