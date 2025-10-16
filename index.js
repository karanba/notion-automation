import { http } from "@google-cloud/functions-framework";
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_HABITS_DATABASE_ID = "232de792635b80e6a595da782add070a";
const EXPECTED_USER_AGENT = "NotionAutomation";

const notion = new Client({ auth: NOTION_TOKEN });

let cachedHabitDataSourceId;

http("helloHttp", async (req, res) => {
  res.set("Content-Type", "text/plain");

  if (!isAuthorizedRequest(req)) {
    res.status(400).send("Invalid request method or user-agent.");
    return;
  }

  const properties = extractProperties(req);
  if (!properties) {
    res.status(400).send("No properties found in the request body.");
    return;
  }

  try {
    const habits = buildHabitsForRequest(req.path, properties);
    if (!habits.length) {
      res.status(200).send("No habits to update.");
      return;
    }

    const pageId = await resolveDailyHabitPageId(properties);
    if (!pageId) {
      res.status(404).send("No page found for the given date.");
      return;
    }

    await updateHabitProperties(pageId, habits);
    res.status(200).send("Habits updated.");
  } catch (error) {
    console.error("Failed to update habit(s):", error);
    res.status(500).send("Failed to update habits.");
  }
});

function isAuthorizedRequest(req) {
  return req.method === "POST" && req.get("user-agent") === EXPECTED_USER_AGENT;
}

function extractProperties(req) {
  const properties = req.body?.data?.properties;
  return properties && typeof properties === "object" ? properties : null;
}

function buildHabitsForRequest(path, properties) {
  const statusName = getStatusName(properties);

  if (path === "/gym") {
    return [
      {
        propertyName: "Gym",
        isDone: statusName === "Done",
      },
    ];
  } else if (path === "/run") {
    return [
      {
        propertyName: "Walk",
        isDone: statusName === "Done",
      },
    ];
  }

  const multiSelectHabits = properties?.Habit?.multi_select;
  if (!Array.isArray(multiSelectHabits)) {
    return [];
  }

  return multiSelectHabits
    .map((habit) => habit?.name?.trim())
    .filter(Boolean)
    .map((habitName) => ({
      propertyName: habitName,
      isDone: statusName === "Done",
    }));
}

function getStatusName(properties) {
  return properties?.Status?.status?.name || "";
}

async function resolveDailyHabitPageId(properties) {
  const dateOnly = resolveDueDate(properties);

  const dataSourceId = await fetchHabitDataSourceId();
  const page = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      property: "Day",
      date: {
        equals: dateOnly,
      },
    },
  });

  return page.results?.[0]?.id ?? null;
}

function resolveDueDate(properties) {
  const raw = (properties?.Due || properties?.Date)?.date?.start;
  if (!raw) throw new Error("Missing due date.");

  // Case 1: already a Date object
  if (raw instanceof Date) {
    return raw.toISOString().split("T")[0]; // keep the written date, no timezone drift
  }

  // Case 2: ISO string (like "2025-10-16T02:00:00.000+03:00")
  if (typeof raw === "string") {
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    throw new Error(`Invalid ISO date string: ${raw}`);
  }

  throw new Error(`Unsupported date type: ${typeof raw}`);
}


async function fetchHabitDataSourceId() {
  if (cachedHabitDataSourceId) {
    return cachedHabitDataSourceId;
  }

  const habitDatabase = await notion.databases.retrieve({
    database_id: NOTION_HABITS_DATABASE_ID,
  });

  const dataSource = habitDatabase?.data_sources?.[0];
  if (!dataSource?.id) {
    throw new Error("Habit database does not have a data source configured.");
  }

  cachedHabitDataSourceId = dataSource.id;
  return cachedHabitDataSourceId;
}

async function updateHabitProperties(pageId, habits) {
  const propertiesToUpdate = habits.reduce((accumulator, habit) => {
    accumulator[habit.propertyName] = {
      checkbox: habit.isDone,
    };
    return accumulator;
  }, {});

  await notion.pages.update({
    page_id: pageId,
    properties: propertiesToUpdate,
  });
}
