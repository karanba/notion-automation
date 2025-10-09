import { http } from "@google-cloud/functions-framework";
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_HABITS_DATABASE_ID = "232de792635b80e6a595da782add070a";

http("helloHttp", async (req, res) => {
  res.set("Content-Type", "text/plain");
  if (req.method === "POST" && req.get("user-agent") == "NotionAutomation") {
    if (
      req.body?.data?.properties &&
      typeof req.body.data.properties === "object"
    ) {
      await updateHabit(req.body.data.properties);
    } else {
      console.log("No properties found in the request body.");
    }
  } else {
    console.log("Invalid request method or user-agent.");
  }
  res.send(`Hello ${req.query.name || req.body.name || "World"}!!`);
});

async function updateHabit(properties) {
  const notion = new Client({
    auth: NOTION_TOKEN,
  });

  const iso = properties.Due.date.start;
  const d = new Date(iso);
  const dateOnly = d.toLocaleDateString("en-CA"); // "2025-10-08" (ISO style, local time)

  const habitDatabase = await notion.databases.retrieve({
    database_id: NOTION_HABITS_DATABASE_ID,
  });
  const dataSource = habitDatabase.data_sources[0];
  const page = await notion.dataSources.query({
    data_source_id: dataSource.id,
    filter: {
      property: "Day",
      date: {
        equals: dateOnly,
      },
    },
  });

  if (page.results.length === 1) {
    const updateParameters = {};

    properties.Habit.multi_select.forEach((habit) => {
      updateParameters[habit.name] = {
        checkbox:
          properties?.Status?.status?.name &&
          properties.Status.status.name === "Done",
      };
    });

    await notion.pages.update({
      page_id: page.results[0].id,
      properties: updateParameters,
    });
  } else {
    console.log("No page found for the given date.");
  }
}
